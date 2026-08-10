//! SVG → primitives — svg_to_drawing.py twin on a custom svgelements
//! replica (NO usvg: usvg converts arcs to cubic Béziers, which breaks the
//! bit-parity contract — arcs stay Arc segments here, see J-entry).
//!
//! Chain: XML walk (roxmltree) → values cascade (transform strings concat,
//! display:none) → viewport/viewBox transform → shapes/paths in px →
//! flatten (0.5 px step, clamped) → mm ×25.4/96, y flipped — then the SAME
//! linework/assembly as DXF.

use crate::dxf::flatten::Primitive;
use crate::{ImportError, ImportResult};

mod length;
mod matrix;
pub mod path;
mod pyfmt;
mod segment;
mod shapes;

use length::Length;
use matrix::Matrix;

const MM_PER_PX: f64 = 25.4 / 96.0;

struct Ctx {
    /// Cascaded transform STRING (parent + ' ' + own), parsed lazily.
    transform: String,
    display_none: bool,
}

/// Read an attribute with style fallback ("display:none" / "transform" in
/// the style attribute count, svgelements merges style into attributes).
fn attr<'a>(node: &roxmltree::Node<'a, '_>, name: &str) -> Option<String> {
    if let Some(v) = node.attribute(name) {
        return Some(v.to_string());
    }
    if let Some(style) = node.attribute("style") {
        for decl in style.split(';') {
            let mut it = decl.splitn(2, ':');
            if let (Some(k), Some(v)) = (it.next(), it.next()) {
                if k.trim() == name {
                    return Some(v.trim().to_string());
                }
            }
        }
    }
    None
}

fn walk(node: &roxmltree::Node, parent: &Ctx, prims: &mut Vec<Primitive>, warnings: &mut Vec<String>, vp: (f64, f64)) {
    let tag = node.tag_name().name();
    // Cascade: own transform string appended to the parent's.
    let mut transform = parent.transform.clone();
    if let Some(t) = attr(node, "transform") {
        if !transform.is_empty() {
            transform.push(' ');
        }
        transform.push_str(&t);
    }
    let display_none = parent.display_none
        || attr(node, "display").map(|d| d.trim().eq_ignore_ascii_case("none")).unwrap_or(false);
    let ctx = Ctx { transform: transform.clone(), display_none };

    match tag {
        "g" | "svg" | "a" | "defs" | "symbol" | "switch" => {
            if !display_none {
                for child in node.children().filter(|c| c.is_element()) {
                    walk(&child, &ctx, prims, warnings, vp);
                }
            }
        }
        "path" => {
            if display_none {
                return;
            }
            if let Some(d) = node.attribute("d") {
                let mut p = path::parse_path(d);
                let m = Matrix::parse(&transform);
                if !m.is_identity() {
                    for s in p.segs.iter_mut() {
                        s.transform(&m);
                    }
                }
                emit_path(&p, prims);
            }
        }
        "rect" | "circle" | "ellipse" | "polyline" | "polygon" => {
            if display_none {
                return;
            }
            let m = Matrix::parse(&transform);
            let shape = build_shape(tag, node, m, vp);
            if let Some(shape) = shape {
                let p = shape.to_path();
                emit_path(&p, prims);
            }
        }
        // `<line>` est un `SimpleLine` pour svgelements — ABSENT de la liste
        // _CONVERTIBLE de svg_to_drawing.py : le pipeline Python le saute
        // (avec warning), donc aucune entité canonique, aucun handle (J-090,
        // verrou svg_shapes : le <line> consommait un handle ici et décalait
        // toute la séquence).
        "text" | "tspan" | "image" | "desc" | "title" | "metadata" | "style" | "use" | "pattern"
        | "line" | "linearGradient" | "radialGradient" | "clipPath" | "mask" | "marker" => {
            warnings.push(format!("Skipping unsupported SVG element: {tag}"));
        }
        _ => {
            if node.is_element() && !tag.is_empty() {
                warnings.push(format!("Skipping unsupported SVG element: {tag}"));
            }
        }
    }
}

/// Shapes: attribute Lengths resolved against the viewport (x/width vs
/// viewport width, y/height vs viewport height — svgelements render()).
fn build_shape(tag: &str, node: &roxmltree::Node, m: Matrix, vp: (f64, f64)) -> Option<shapes::Shape> {
    let (vw, vh) = vp;
    let len = |name: &str, default: &str, rel: f64| -> f64 {
        Length::parse(&attr(node, name).unwrap_or_else(|| default.to_string())).value_px(Some(rel))
    };
    match tag {
        "circle" => {
            let r = Length::parse(&attr(node, "r").unwrap_or_else(|| "0".into())).value_px(None);
            Some(shapes::Shape::Circle {
                cx: len("cx", "0", vw),
                cy: len("cy", "0", vh),
                rx: r,
                ry: r,
                transform: m,
            })
        }
        "ellipse" => Some(shapes::Shape::Circle {
            cx: len("cx", "0", vw),
            cy: len("cy", "0", vh),
            rx: len("rx", "0", vw),
            ry: len("ry", "0", vh),
            transform: m,
        }),
        "rect" => {
            let rxs = attr(node, "rx");
            let rys = attr(node, "ry");
            let rx = rxs.as_deref().map(|s| Length::parse(s).value_px(Some(vw)));
            let ry = rys.as_deref().map(|s| Length::parse(s).value_px(Some(vh)));
            Some(shapes::Shape::Rect {
                x: len("x", "0", vw),
                y: len("y", "0", vh),
                width: len("width", "0", vw),
                height: len("height", "0", vh),
                rx,
                ry,
                transform: m,
            })
        }
        "line" => Some(shapes::Shape::Line {
            x1: len("x1", "0", vw),
            y1: len("y1", "0", vh),
            x2: len("x2", "0", vw),
            y2: len("y2", "0", vh),
            transform: m,
        }),
        "polyline" | "polygon" => {
            let pts_attr = node.attribute("points").unwrap_or("");
            let nums = tokenize_floats(pts_attr);
            let mut points = Vec::with_capacity(nums.len() / 2);
            for pair in nums.chunks_exact(2) {
                points.push([pair[0], pair[1]]);
            }
            Some(shapes::Shape::Poly { points, polygon: tag == "polygon", transform: m })
        }
        _ => None,
    }
}

/// points attribute: floats separated by comma-wsp (REGEX_COORD_PAIR twin).
fn tokenize_floats(s: &str) -> Vec<f64> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b',' || (c as char).is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && bytes[i] != b',' && !(bytes[i] as char).is_whitespace() {
            i += 1;
        }
        if let Ok(v) = s[start..i].parse::<f64>() {
            out.push(v);
        }
    }
    out
}

/// Flattened subpaths → polyline primitives (px → mm, y flipped).
fn emit_path(p: &path::PathBuf, prims: &mut Vec<Primitive>) {
    for (points, closed) in path::flatten_path(p) {
        let mm: Vec<[f64; 2]> = points
            .iter()
            .map(|q| [q[0] * MM_PER_PX, -q[1] * MM_PER_PX])
            .collect();
        if mm.len() >= 2 {
            prims.push(Primitive::Polyline {
                points: mm,
                closed,
                handle: String::new(),
                layer: "0".to_string(),
            });
        }
    }
}

/// ViewBox + viewport handling (SVG.parse root twin): physical width/height
/// (96 dpi) defaulting to viewBox dims or 1000; viewport transform string.
fn root_viewport(node: &roxmltree::Node) -> ((f64, f64), String) {
    let viewbox = node.attribute("viewBox").and_then(|vb| {
        let nums = tokenize_floats(vb);
        if nums.len() == 4 && nums[2] != 0.0 && nums[3] != 0.0 {
            Some((nums[0], nums[1], nums[2], nums[3]))
        } else {
            None
        }
    });
    let aspect = node.attribute("preserveAspectRatio").unwrap_or("").to_string();
    let (w_px, h_px) = match (node.attribute("width"), node.attribute("height")) {
        (Some(w), Some(h)) => (
            Length::parse(w).value_px(None),
            Length::parse(h).value_px(None),
        ),
        _ => match viewbox {
            Some((_, _, vw, vh)) => (vw, vh),
            None => (1000.0, 1000.0),
        },
    };
    let viewport_transform = match viewbox {
        None => String::new(),
        Some((vbx, vby, vbw, vbh)) => {
            viewbox_transform(0.0, 0.0, w_px, h_px, vbx, vby, vbw, vbh, &aspect)
        }
    };
    ((w_px, h_px), viewport_transform)
}

/// Viewbox.viewbox_transform twin (SVG 2.0 8.2).
#[allow(clippy::too_many_arguments)]
fn viewbox_transform(
    e_x: f64,
    e_y: f64,
    e_width: f64,
    e_height: f64,
    vb_x: f64,
    vb_y: f64,
    vb_width: f64,
    vb_height: f64,
    aspect: &str,
) -> String {
    let mut parts = aspect.split_whitespace();
    let align = parts.next().unwrap_or("xMidyMid");
    let meet_or_slice = parts.next().unwrap_or("meet");
    let mut scale_x = e_width / vb_width;
    let mut scale_y = e_height / vb_height;
    if align != "none" && meet_or_slice == "meet" {
        scale_x = scale_x.min(scale_y);
        scale_y = scale_x;
    } else if align != "none" && meet_or_slice == "slice" {
        scale_x = scale_x.max(scale_y);
        scale_y = scale_x;
    }
    let mut translate_x = e_x - vb_x * scale_x;
    let mut translate_y = e_y - vb_y * scale_y;
    let align = align.to_lowercase();
    if align.contains("xmid") {
        translate_x += (e_width - vb_width * scale_x) / 2.0;
    }
    if align.contains("xmax") {
        translate_x += e_width - vb_width * scale_x;
    }
    if align.contains("ymid") {
        translate_y += (e_height - vb_height * scale_y) / 2.0;
    }
    if align.contains("ymax") {
        translate_y += e_height - vb_height * scale_y;
    }
    if translate_x == 0.0 && translate_y == 0.0 {
        if scale_x == 1.0 && scale_y == 1.0 {
            String::new()
        } else {
            format!("scale({}, {})", pyfmt::fmt_length_str(scale_x), pyfmt::fmt_length_str(scale_y))
        }
    } else if scale_x == 1.0 && scale_y == 1.0 {
        format!(
            "translate({}, {})",
            pyfmt::fmt_length_str(translate_x),
            pyfmt::fmt_length_str(translate_y)
        )
    } else {
        format!(
            "translate({}, {}) scale({}, {})",
            pyfmt::fmt_length_str(translate_x),
            pyfmt::fmt_length_str(translate_y),
            pyfmt::fmt_length_str(scale_x),
            pyfmt::fmt_length_str(scale_y)
        )
    }
}

/// svg_bytes_to_drawing twin: parse → flatten → primitives mm (y-up).
/// Zero convertible geometry = clean error (parity of behavior).
///
/// Handles (J-090) : les primitives reçoivent la séquence canonique ezdxf
/// (2F, 30, …, une LWPOLYLINE = un handle) — les mêmes handles que portent
/// les LWPOLYLINEs synthétisés de `canonical_dxf`, pour l'export par handle.
pub fn import_svg(bytes: &[u8], flatten_tol: f64) -> Result<ImportResult, ImportError> {
    let (prims, mut warnings, entity_count) = svg_primitives(bytes)?;
    let (linework, w2, _) = crate::assemble::collect_linework(&prims, flatten_tol);
    warnings.extend(w2);
    let parts = crate::assemble::build_parts(linework, flatten_tol);
    Ok(ImportResult { parts, source_units: 4, entity_count, warnings })
}

/// Parse + flatten SVG → primitives mm (y-up), handles canoniques assignés.
/// Point d'injection unique partagé par import_svg et canonical_dxf : même
/// source ⇒ même ordre ⇒ même séquence de handles.
fn svg_primitives(bytes: &[u8]) -> Result<(Vec<Primitive>, Vec<String>, usize), ImportError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|e| ImportError::Corrupt(format!("Unreadable SVG file: {e}")))?;
    let doc = roxmltree::Document::parse(text)
        .map_err(|e| ImportError::Corrupt(format!("Unreadable SVG file: {e}")))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" {
        return Err(ImportError::Corrupt("Unreadable SVG file: root is not <svg>".into()));
    }
    let (vp, viewport_transform) = root_viewport(&root);
    // svgelements : transform propre de la racine PUIS viewport transform.
    let mut root_transform = String::new();
    if let Some(t) = attr(&root, "transform") {
        root_transform.push_str(&t);
    }
    if !viewport_transform.is_empty() {
        if !root_transform.is_empty() {
            root_transform.push(' ');
        }
        root_transform.push_str(&viewport_transform);
    }
    let mut prims = Vec::new();
    let mut warnings = Vec::new();
    let ctx = Ctx { transform: root_transform, display_none: false };
    for child in root.children().filter(|c| c.is_element()) {
        walk(&child, &ctx, &mut prims, &mut warnings, vp);
    }
    let entity_count = prims.len();
    if entity_count == 0 {
        return Err(ImportError::Corrupt(
            "No convertible geometry found in SVG (paths/shapes only)".to_string(),
        ));
    }
    // Séquence canonique (svg_bytes_to_drawing → ezdxf.new("R2010") : les
    // add_lwpolyline reçoivent 2F, 30, 31, … dans l'ordre d'émission).
    let mut hg = crate::dxf::canonical::HandleGen::new();
    for p in prims.iter_mut() {
        if let Primitive::Polyline { handle, .. } = p {
            *handle = hg.next_handle();
        }
    }
    Ok((prims, warnings, entity_count))
}

/// Bytes DXF canoniques d'une source SVG (svg_bytes_to_drawing twin) :
/// LWPOLYLINEs aplaties (0,5 px, mm, y-up) avec handles canoniques,
/// $INSUNITS=4 / $MEASUREMENT=1, ACADVER AC1024 (ezdxf.new("R2010")).
pub fn canonical_dxf(bytes: &[u8]) -> Result<Vec<u8>, ImportError> {
    let (prims, _, _) = svg_primitives(bytes)?;
    let entities: Vec<crate::dxf::entities::Entity> = prims
        .into_iter()
        .filter_map(|p| match p {
            Primitive::Polyline { points, closed, handle, layer } => {
                Some(crate::dxf::entities::Entity::LwPolyline(
                    crate::dxf::entities::LwPolyline {
                        bulges: vec![0.0; points.len()],
                        points,
                        closed,
                        common: crate::dxf::entities::Common {
                            handle,
                            layer,
                            color: 256,
                        },
                    },
                ))
            }
            _ => None,
        })
        .collect();
    Ok(crate::dxf::canonical::emit_dxf(&entities, "AC1024"))
}
