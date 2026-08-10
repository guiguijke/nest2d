//! Canonical DXF bytes (J-090) — jumeau de `_make_dxf_copy` /
//! `read_dxf_file` (workers/fileprocessing) : le pipeline Python n'écrit
//! JAMAIS le DXF source tel quel, il le REBUILD dans un document neuf :
//! cleanup (TEXT/MTEXT/IMAGE/SOLID supprimés) → `recursive_decompose`
//! (INSERTs résolus en place, ordre modelspace) → scale unitaire → mm →
//! `add_entity` sur un `ezdxf.new()`, puis `$INSUNITS=4` + `$MEASUREMENT=1`.
//!
//! **Handles canoniques** : `entity.copy()` jette le handle source et
//! `EntityDB.add` en assigne un frais — TOUS les entities (pas seulement
//! ceux issus d'INSERT) reçoivent la séquence ezdxf du document neuf :
//! `2F, 30, 31, …` (hex uppercase, premier handle libre après le contenu
//! par défaut d'ezdxf.new(), mesuré sur ezdxf 1.4.4). Une POLYLINE legacy
//! consomme en plus 1 handle par VERTEX + 1 pour la SEQEND
//! (`add_sub_entities_to_entitydb`, ordre : polyline, vertices, seqend).
//! Conséquence verrouillée par les tests : `parts[].handles` (attachés à
//! l'import) et `canonical_dxf` (réémission) partagent LA MÊME séquence,
//! et `canonical_dxf ∘ canonical_dxf` est idempotent.
//!
//! Divergences documentées (périmètre import existant, PIPELINE-MAP §1.3) :
//! HATCH→lignes non porté, ATTRIB d'INSERT ignoré — les handles Python
//! correspondants n'existent pas ici ; les POLYLINE « mesh » (flags 16/32/64)
//! sous-estiment le compte de VERTEX (pas du linework de découpe).

use super::entities::{self, Entity};
use super::{decompose, Document};
use crate::units;

/// Premier handle du document neuf ezdxf (contenu par défaut = handles
/// 1..2E ; le 47e = 0x2F — mesuré sur ezdxf 1.4.4, natif ET 'R2010').
pub const CANONICAL_HANDLE_SEED: u32 = 0x2F;

/// Séquenceur de handles ezdxf (`HandleGenerator` : "%X", +1 à chaque appel,
/// les handles déjà pris sont sautés — jamais atteint ici puisque la
/// séquence part au-delà du contenu par défaut et croît strictement).
#[derive(Debug, Clone)]
pub struct HandleGen {
    next: u32,
}

impl HandleGen {
    pub fn new() -> Self {
        HandleGen { next: CANONICAL_HANDLE_SEED }
    }
    pub fn next_handle(&mut self) -> String {
        let h = format!("{:X}", self.next);
        self.next += 1;
        h
    }
}

impl Default for HandleGen {
    fn default() -> Self {
        Self::new()
    }
}

/// Assigne les handles canoniques à une liste d'entités DANS L'ORDRE
/// (jumeau de la boucle copy+add_entity de read_dxf_file).
pub fn assign_canonical_handles(entities: &mut [Entity]) {
    let mut hg = HandleGen::new();
    for e in entities.iter_mut() {
        match e {
            Entity::Line(x) => x.common.handle = hg.next_handle(),
            Entity::LwPolyline(x) => x.common.handle = hg.next_handle(),
            Entity::Arc(x) => x.common.handle = hg.next_handle(),
            Entity::Circle(x) => x.common.handle = hg.next_handle(),
            Entity::Ellipse(x) => x.common.handle = hg.next_handle(),
            Entity::Spline(x) => x.common.handle = hg.next_handle(),
            Entity::Point(x) => x.common.handle = hg.next_handle(),
            Entity::Polyline(x) => {
                x.common.handle = hg.next_handle();
                x.vertex_handles = (0..x.points.len()).map(|_| hg.next_handle()).collect();
                x.seqend_handle = hg.next_handle();
            }
            // INSERT est résolu avant ; Unsupported filtré avant.
            Entity::Insert(x) => x.common.handle = hg.next_handle(),
            Entity::Unsupported(_) => {}
        }
    }
}

/// Entités canoniques mm du document : cleanup (Unsupported skippé avec
/// warning, jumeau du delete TEXT/MTEXT/IMAGE/SOLID), decompose (INSERTs
/// résolus), scale unitaire, handles canoniques. C'est LA source de vérité
/// commune à l'import (footprints) et à `canonical_dxf` (réémission).
pub fn canonical_entities(doc: &Document) -> (Vec<Entity>, Vec<String>) {
    let mut kept: Vec<Entity> = Vec::new();
    let mut warnings = Vec::new();
    for e in &doc.entities {
        match e {
            Entity::Unsupported(kind) => {
                warnings.push(format!("skipped entity {kind}"));
            }
            _ => kept.push(e.clone()),
        }
    }
    let mut flat = decompose::decompose_to_entities(&kept, &doc.blocks);

    // Unités : decompose D'ABORD, scale uniforme ensuite (AGENTS #26).
    let (factor, unknown) = units::factor_to_mm(doc.source_insunits);
    if unknown {
        warnings.push(format!(
            "unknown $INSUNITS={} — assuming millimeters",
            doc.source_insunits
        ));
    }
    if factor != 1.0 {
        for e in flat.iter_mut() {
            scale_entity(e, factor);
        }
    }
    assign_canonical_handles(&mut flat);
    (flat, warnings)
}

/// Scale uniforme au niveau entité (jumeau de `entity.transform(scale_matrix)`
/// ezdxf) : points/rays × k, angles et paramètres inchangés, bulges/knots/
/// weights inchangés (un scale uniforme préserve la forme — parité avec le
/// comportement de Primitive::scaled côté nesting).
pub fn scale_entity(e: &mut Entity, k: f64) {
    let s = |p: &mut [f64; 2]| {
        p[0] *= k;
        p[1] *= k;
    };
    match e {
        Entity::Line(x) => {
            s(&mut x.start);
            s(&mut x.end);
        }
        Entity::LwPolyline(x) => x.points.iter_mut().for_each(s),
        Entity::Polyline(x) => x.points.iter_mut().for_each(s),
        Entity::Point(x) => s(&mut x.at),
        Entity::Circle(x) => {
            s(&mut x.center);
            x.radius *= k;
        }
        Entity::Arc(x) => {
            s(&mut x.center);
            x.radius *= k;
        }
        Entity::Ellipse(x) => {
            s(&mut x.center);
            s(&mut x.major);
        }
        Entity::Spline(x) => x.control.iter_mut().for_each(s),
        Entity::Insert(_) | Entity::Unsupported(_) => {}
    }
}

// ------------------------------------------------------------- émission DXF

/// `str(float)` Python (repr shortest-round-trip) — port local de
/// nest-export::pyfloat (nest-export dépend de nest-import : impossible de
/// l'importer ici sans cycle ; garder les deux en sync si évolution).
fn py_str(v: f64) -> String {
    if v == 0.0 {
        return if v.is_sign_negative() { "-0.0".into() } else { "0.0".into() };
    }
    if !v.is_finite() {
        return if v.is_nan() {
            "nan".into()
        } else if v > 0.0 {
            "inf".into()
        } else {
            "-inf".into()
        };
    }
    let sign = if v < 0.0 { "-" } else { "" };
    let a = v.abs();
    let efmt = format!("{:e}", a);
    let (mant, exp): (&str, i32) = match efmt.split_once('e') {
        Some((m, x)) => (m, x.parse().unwrap_or(0)),
        None => (efmt.as_str(), 0),
    };
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    // valeur = 0.digits * 10^(exp+1) ≡ d.ddd * 10^exp
    if (-4..=15).contains(&exp) {
        let n = digits.len() as i32;
        let int_len = exp + 1;
        let mut s = String::from(sign);
        if int_len >= n {
            s.push_str(&digits);
            for _ in 0..(int_len - n) {
                s.push('0');
            }
            s.push_str(".0");
        } else if int_len <= 0 {
            s.push('0');
            s.push('.');
            for _ in 0..(-int_len) {
                s.push('0');
            }
            s.push_str(&digits);
        } else {
            let (ip, fp) = digits.split_at(int_len as usize);
            s.push_str(ip);
            s.push('.');
            s.push_str(fp);
        }
        s
    } else {
        let mut s = String::from(sign);
        let (d0, rest) = digits.split_at(1);
        s.push_str(d0);
        if !rest.is_empty() {
            s.push('.');
            s.push_str(rest);
        }
        s.push('e');
        s.push(if exp < 0 { '-' } else { '+' });
        s.push_str(&format!("{:02}", exp.abs()));
        s
    }
}

use std::fmt::Write as _;

fn grp(s: &mut String, code: i32, v: &str) {
    let _ = writeln!(s, "{}\n{}", code, v);
}
fn num(s: &mut String, code: i32, v: f64) {
    // Pleine précision, jamais arrondi (AGENTS #28) — repr shortest.
    let _ = writeln!(s, "{}\n{}", code, py_str(v));
}
fn int(s: &mut String, code: i32, v: i64) {
    // Codes de groupes ENTIERS (62/66/70/71/72/73/90) — jamais de "4.0" :
    // notre parser et ezdxf lisent des entiers stricts.
    let _ = writeln!(s, "{}\n{}", code, v);
}

fn common(s: &mut String, c: &entities::Common) {
    if !c.handle.is_empty() {
        grp(s, 5, &c.handle);
    }
    grp(s, 100, "AcDbEntity");
    grp(s, 8, if c.layer.is_empty() { "0" } else { &c.layer });
    if c.color != 256 {
        int(s, 62, c.color as i64);
    }
}

/// Émet une entité à transformation IDENTITÉ (le canonical est déjà en mm
/// modelspace). Retourne false si type non exportable (Unsupported/INSERT —
/// ne doit pas arriver après canonical_entities).
fn write_entity(s: &mut String, e: &Entity) -> bool {
    match e {
        Entity::Line(l) => {
            grp(s, 0, "LINE");
            common(s, &l.common);
            grp(s, 100, "AcDbLine");
            num(s, 10, l.start[0]);
            num(s, 20, l.start[1]);
            num(s, 11, l.end[0]);
            num(s, 21, l.end[1]);
            true
        }
        Entity::LwPolyline(p) => {
            grp(s, 0, "LWPOLYLINE");
            common(s, &p.common);
            grp(s, 100, "AcDbPolyline");
            int(s, 90, p.points.len() as i64);
            int(s, 70, if p.closed { 1 } else { 0 });
            for (i, pt) in p.points.iter().enumerate() {
                num(s, 10, pt[0]);
                num(s, 20, pt[1]);
                let b = p.bulges.get(i).copied().unwrap_or(0.0);
                if b != 0.0 {
                    num(s, 42, b);
                }
            }
            true
        }
        Entity::Polyline(p) => {
            grp(s, 0, "POLYLINE");
            common(s, &p.common);
            int(s, 70, if p.closed { 1 } else { 0 });
            int(s, 66, 1);
            for (i, pt) in p.points.iter().enumerate() {
                grp(s, 0, "VERTEX");
                // Handle de sous-entité : séquence canonique si disponible.
                if let Some(h) = p.vertex_handles.get(i).filter(|h| !h.is_empty()) {
                    grp(s, 5, h);
                }
                grp(s, 100, "AcDbEntity");
                grp(s, 100, "AcDbVertex");
                grp(s, 100, "AcDbPolyline2dVertex");
                num(s, 10, pt[0]);
                num(s, 20, pt[1]);
                int(s, 70, 0);
            }
            grp(s, 0, "SEQEND");
            if !p.seqend_handle.is_empty() {
                grp(s, 5, &p.seqend_handle);
            }
            grp(s, 100, "AcDbEntity");
            true
        }
        Entity::Arc(a) => {
            grp(s, 0, "ARC");
            common(s, &a.common);
            grp(s, 100, "AcDbCircle");
            num(s, 10, a.center[0]);
            num(s, 20, a.center[1]);
            num(s, 40, a.radius);
            grp(s, 100, "AcDbArc");
            num(s, 50, a.start_angle);
            num(s, 51, a.end_angle);
            true
        }
        Entity::Circle(c) => {
            grp(s, 0, "CIRCLE");
            common(s, &c.common);
            grp(s, 100, "AcDbCircle");
            num(s, 10, c.center[0]);
            num(s, 20, c.center[1]);
            num(s, 40, c.radius);
            true
        }
        Entity::Ellipse(e) => {
            grp(s, 0, "ELLIPSE");
            common(s, &e.common);
            grp(s, 100, "AcDbEllipse");
            num(s, 10, e.center[0]);
            num(s, 20, e.center[1]);
            num(s, 11, e.major[0]);
            num(s, 21, e.major[1]);
            num(s, 40, e.ratio);
            num(s, 41, e.start_param);
            num(s, 42, e.end_param);
            true
        }
        Entity::Spline(sp) => {
            grp(s, 0, "SPLINE");
            common(s, &sp.common);
            grp(s, 100, "AcDbSpline");
            int(s, 70, 0);
            int(s, 71, sp.degree as i64);
            int(s, 72, sp.knots.len() as i64);
            int(s, 73, sp.control.len() as i64);
            for k in &sp.knots {
                num(s, 40, *k);
            }
            for c in &sp.control {
                num(s, 10, c[0]);
                num(s, 20, c[1]);
            }
            for w in &sp.weights {
                num(s, 41, *w);
            }
            true
        }
        Entity::Point(p) => {
            grp(s, 0, "POINT");
            common(s, &p.common);
            grp(s, 100, "AcDbPoint");
            num(s, 10, p.at[0]);
            num(s, 20, p.at[1]);
            true
        }
        _ => false,
    }
}

/// Réémission canonique mm d'une liste d'entités (déjà décomposées/scalées/
/// handlées). Structure minimale lisible par ezdxf (recover) ET par notre
/// parser — mêmes codes de groupes que le writer nest-export.
/// `acadver` : AC1027 pour une source DXF (ezdxf.new() par défaut, J-071),
/// AC1024 pour une source SVG (svg_bytes_to_drawing = ezdxf.new("R2010")).
pub fn emit_dxf(entities: &[Entity], acadver: &str) -> Vec<u8> {
    let mut body = String::new();
    let mut layers: Vec<String> = Vec::new();
    for e in entities {
        let layer = layer_of(e);
        if !layers.contains(&layer) {
            layers.push(layer);
        }
        write_entity(&mut body, e);
    }

    let mut s = String::new();
    grp(&mut s, 0, "SECTION");
    grp(&mut s, 2, "HEADER");
    grp(&mut s, 9, "$ACADVER");
    grp(&mut s, 1, acadver);
    grp(&mut s, 9, "$INSUNITS");
    int(&mut s, 70, 4);
    grp(&mut s, 9, "$MEASUREMENT");
    int(&mut s, 70, 1);
    grp(&mut s, 0, "ENDSEC");

    grp(&mut s, 0, "SECTION");
    grp(&mut s, 2, "TABLES");
    grp(&mut s, 0, "TABLE");
    grp(&mut s, 2, "LAYER");
    for name in &layers {
        grp(&mut s, 0, "LAYER");
        grp(&mut s, 2, name);
        int(&mut s, 70, 0);
        int(&mut s, 62, 7);
    }
    grp(&mut s, 0, "ENDTAB");
    grp(&mut s, 0, "ENDSEC");

    grp(&mut s, 0, "SECTION");
    grp(&mut s, 2, "ENTITIES");
    s.push_str(&body);
    grp(&mut s, 0, "ENDSEC");
    grp(&mut s, 0, "EOF");
    s.into_bytes()
}

fn layer_of(e: &Entity) -> String {
    let l: &str = match e {
        Entity::Line(x) => x.common.layer.as_str(),
        Entity::LwPolyline(x) => x.common.layer.as_str(),
        Entity::Polyline(x) => x.common.layer.as_str(),
        Entity::Arc(x) => x.common.layer.as_str(),
        Entity::Circle(x) => x.common.layer.as_str(),
        Entity::Ellipse(x) => x.common.layer.as_str(),
        Entity::Spline(x) => x.common.layer.as_str(),
        Entity::Point(x) => x.common.layer.as_str(),
        Entity::Insert(x) => x.common.layer.as_str(),
        Entity::Unsupported(_) => "0",
    };
    if l.is_empty() { "0".into() } else { l.to_string() }
}

/// Bytes DXF canoniques mm d'une source DXF (jumeau `_make_dxf_copy` chemin
/// DXF : rebuild complet, handles frais séquentiels — jamais le source tel
/// quel, voir l'en-tête du module).
pub fn canonical_dxf_bytes(doc: &Document) -> Vec<u8> {
    let (entities, _) = canonical_entities(doc);
    emit_dxf(&entities, "AC1027")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_sequence_matches_ezdxf_fresh_doc() {
        // Verrou mesuré ezdxf 1.4.4 : premier handle 2F, hex uppercase, +1.
        let mut g = HandleGen::new();
        assert_eq!(g.next_handle(), "2F");
        assert_eq!(g.next_handle(), "30");
        assert_eq!(g.next_handle(), "31");
    }

    #[test]
    fn polyline_consumes_vertex_and_seqend_handles() {
        // Verrou mesuré : POLYLINE=2F, 4×VERTEX=30..33, SEQEND=34 (ezdxf).
        let mut ents = vec![
            Entity::Polyline(entities::Polyline {
                points: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
                closed: true,
                common: entities::Common::default(),
                vertex_handles: vec![],
                seqend_handle: String::new(),
            }),
            Entity::Line(entities::Line {
                start: [0.0, 0.0],
                end: [1.0, 1.0],
                common: entities::Common::default(),
            }),
        ];
        assign_canonical_handles(&mut ents);
        match &ents[0] {
            Entity::Polyline(p) => {
                assert_eq!(p.common.handle, "2F");
                assert_eq!(p.vertex_handles, vec!["30", "31", "32", "33"]);
                assert_eq!(p.seqend_handle, "34");
            }
            _ => panic!(),
        }
        match &ents[1] {
            Entity::Line(l) => assert_eq!(l.common.handle, "35"),
            _ => panic!(),
        }
    }

    #[test]
    fn emit_dxf_is_reparseable_with_handles() {
        let mut ents = vec![Entity::LwPolyline(entities::LwPolyline {
            points: vec![[0.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 50.0]],
            bulges: vec![0.0, 0.5, 0.0, 0.0],
            closed: true,
            common: entities::Common {
                handle: String::new(),
                layer: "CUT".into(),
                color: 3,
            },
        })];
        assign_canonical_handles(&mut ents);
        let bytes = emit_dxf(&ents, "AC1027");
        let doc = Document::parse(&bytes).expect("reparse");
        assert_eq!(doc.source_insunits, 4);
        assert_eq!(doc.entities.len(), 1);
        match &doc.entities[0] {
            Entity::LwPolyline(p) => {
                assert_eq!(p.common.handle, "2F");
                assert_eq!(p.common.layer, "CUT");
                assert_eq!(p.common.color, 3);
                assert!(p.closed);
                assert_eq!(p.bulges, vec![0.0, 0.5, 0.0, 0.0]);
                assert_eq!(p.points.len(), 4);
            }
            other => panic!("expected LwPolyline, got {other:?}"),
        }
    }

    #[test]
    fn py_str_smoke() {
        assert_eq!(py_str(0.0), "0.0");
        assert_eq!(py_str(100.0), "100.0");
        assert_eq!(py_str(11.811023622047244), "11.811023622047244");
        assert_eq!(py_str(1e-5), "1e-05");
        assert_eq!(py_str(0.30000000000000004), "0.30000000000000004");
    }
}
