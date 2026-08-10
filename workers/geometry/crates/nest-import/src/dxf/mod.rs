//! DXF group-code reader for the REAL entity subset (never the full spec —
//! docs/PIPELINE-MAP.md §2). Mirrors ezdxf.recover behavior: lenient parsing,
//! malformed entities skipped (never a crash), duplicate handles tolerated.

pub mod canonical;
pub mod decompose;
pub mod entities;
pub mod flatten;

use crate::ImportError;
use entities::Entity;

/// Parsed DXF document: header vars, block definitions, modelspace entities.
pub struct Document {
    /// $INSUNITS code of the SOURCE file (0 = unitless).
    pub source_insunits: i32,
    pub blocks: Vec<entities::Block>,
    pub entities: Vec<Entity>,
}

pub struct GroupReader<'a> {
    lines: std::str::Lines<'a>,
}

impl<'a> GroupReader<'a> {
    /// Yields (group code, raw value string) pairs. DXF is ASCII/UTF-8 text;
    /// invalid bytes were already lossy-decoded by the caller.
    pub fn next(&mut self) -> Option<(i32, &'a str)> {
        let code_line = self.lines.next()?;
        let value_line = self.lines.next().unwrap_or("");
        let code: i32 = code_line.trim().parse().unwrap_or(-1);
        Some((code, value_line))
    }
}

fn parse_f64(s: &str) -> Option<f64> {
    // f64::from_str is correctly rounded (Eisel-Lemire) — identical bits to
    // Python float() (David Gay) for the same decimal string.
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    // DXF writes exponents with 'D' on old files.
    let t = t.replace('D', "E").replace('d', "e");
    t.parse::<f64>().ok()
}

impl Document {
    pub fn parse(bytes: &[u8]) -> Result<Document, ImportError> {
        let text = String::from_utf8_lossy(bytes);
        if text.len() < 16 {
            return Err(ImportError::Corrupt("file too small".into()));
        }
        let mut reader = GroupReader { lines: text.lines() };
        let mut insunits: i32 = 0;
        let mut blocks = Vec::new();
        let mut entities = Vec::new();

        // Section state machine: HEADER (vars), BLOCKS, ENTITIES.
        enum Section {
            None,
            Header,
            Blocks,
            Entities,
            Other,
        }
        let mut section = Section::None;
        // Lookahead: entity readers stop AT the (0, name) group starting the
        // next entity — it must be re-dispatched, not swallowed.
        let mut pending: Option<(i32, String)> = None;
        macro_rules! next_group {
            () => {
                match pending.take() {
                    Some(g) => Some((g.0, g.1)),
                    None => reader.next().map(|(c, v)| (c, v.to_string())),
                }
            };
        }

        while let Some((code, value)) = next_group!() {
            match code {
                2 if matches!(section, Section::None) => match value.trim() {
                    "HEADER" => section = Section::Header,
                    "BLOCKS" => section = Section::Blocks,
                    "ENTITIES" => section = Section::Entities,
                    "TABLES" | "CLASSES" | "OBJECTS" => section = Section::Other,
                    _ => {}
                },
                0 => {
                    let name = value.trim();
                    match section {
                        Section::Header => {
                            if name == "ENDSEC" {
                                section = Section::None;
                            }
                        }
                        Section::Blocks => match name {
                            "ENDSEC" => section = Section::None,
                            "BLOCK" => {
                                let (block, look, r) = entities::read_block(reader);
                                reader = r;
                                pending = look;
                                blocks.push(block);
                            }
                            _ => {}
                        },
                        Section::Entities => match name {
                            "ENDSEC" => section = Section::None,
                            "EOF" => break,
                            _ => {
                                let (entity, look, r) = entities::read_entity(name, reader);
                                reader = r;
                                pending = look;
                                if let Some(e) = entity {
                                    entities.push(e);
                                }
                            }
                        },
                        Section::Other => {
                            if name == "ENDSEC" {
                                section = Section::None;
                            }
                        }
                        _ => {}
                    }
                }
                9 if matches!(section, Section::Header) => {
                    if value.trim() == "$INSUNITS" {
                        // The value is the NEXT group (code 70).
                        if let Some((c, v)) = next_group!() {
                            if c == 70 {
                                insunits = v.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(Document {
            source_insunits: insunits,
            blocks,
            entities,
        }
        .with_recover_drops())
    }

    /// ezdxf.recover supprime à l'audit les entités structurellement
    /// invalides (elles n'entrent JAMAIS dans le modelspace — ni dans
    /// entity_count, ni dans la séquence des handles canoniques, J-090).
    /// Réplique du cas observé sur corpus : SPLINE dont le nombre de nœuds
    /// est insuffisant (« Removed SPLINE(#2F) with invalid knot value count:
    /// 0 < 16 » — règle : knots < control + degree + 1).
    fn with_recover_drops(mut self) -> Document {
        fn valid(e: &Entity) -> bool {
            match e {
                Entity::Spline(sp) => {
                    sp.knots.len() >= sp.control.len() + (sp.degree as usize + 1)
                }
                _ => true,
            }
        }
        self.entities.retain(valid);
        for b in self.blocks.iter_mut() {
            b.entities.retain(valid);
        }
        self
    }
}

/// Modelspace flattened to primitive entities: cleanup (TEXT/MTEXT/IMAGE/
/// SOLID removed), blocks resolved, units normalized to mm — the exact twin
/// of read_dxf_file + recursive_decompose + scale. Returns (primitives,
/// skipped-entity warnings). The primitive count IS the modelspace entity
/// count the Python pipeline gates on (MAX_ENTITY_LIMIT).
///
/// Handles: J-090, les primitives portent les handles CANONIQUES (séquence
/// ezdxf du document rebuildé — voir canonical.rs), PAS les handles source :
/// le Python attache les handles du document canonique (build_geometry tourne
/// sur validDxf), et `canonical_dxf` réémet ces mêmes handles.
pub fn flattened_modelspace(doc: &Document) -> (Vec<flatten::Primitive>, Vec<String>) {
    let (entities, warnings) = canonical::canonical_entities(doc);
    let prims = entities.iter().map(decompose::primitive_of).collect();
    (prims, warnings)
}
