//! SVG de résultat — parité BYTE-LEVEL (régime 2, mission v2 PR3) :
//! mêmes format strings que le Python (`.3f` + `str(float)` via pyfloat),
//! mêmes couleurs/opacités (colors.py), même convention de flip
//! `translate(x, H-y) scale(1 -1) rotate(deg)` (AGENTS #20b).

use crate::pyfloat::{py_fixed, py_str};
use crate::transform::Placement;
use std::collections::HashMap;

pub const FALLBACK_PART_COLOR: &str = "#2563EB";
pub const SHEET_FRAME_COLOR: &str = "#3B82F6";
pub const SHEET_FILL: &str = "#FFFFFF";
pub const FALLBACK_PREVIEW_COLOR: &str = "#00FF00";
pub const LEGACY_HOLE_COLOR: &str = "#0080FF";
pub const FILL_OPACITY_PREVIEW: f64 = 0.18;
pub const FILL_OPACITY_LAYOUT: f64 = 0.35;

/// Item d'entrée (anneaux + couleur) — jumeau du dict Python `item`.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Item {
    pub coords: Vec<[f64; 2]>,
    #[serde(default)]
    pub holes: Vec<Vec<[f64; 2]>>,
    #[serde(default)]
    pub color: Option<String>,
}

/// svg_colored.build_colored_sheet_svg — SHA-256 identique au Python.
pub fn build_colored_sheet_svg(
    transforms: &[Placement],
    items_by_id: &HashMap<String, Item>,
    bin_width: f64,
    bin_height: f64,
    unit_scale: f64,
    unit_attr: &str,
) -> String {
    let w = bin_width * unit_scale;
    let h = bin_height * unit_scale;
    let stroke_width = w.min(h) * 0.002;

    let mut parts: Vec<String> = vec![
        "<?xml version='1.0' encoding='utf-8'?>".to_string(),
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}{}\" height=\"{}{}\" viewBox=\"0 0 {} {}\">",
            py_str(w), unit_attr, py_str(h), unit_attr, py_str(w), py_str(h)
        ),
        format!(
            "<rect x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" fill=\"{}\" stroke=\"{}\" stroke-width=\"{}\" />",
            py_str(w),
            py_str(h),
            SHEET_FILL,
            SHEET_FRAME_COLOR,
            py_str(stroke_width * 1.5)
        ),
    ];

    for t in transforms {
        let item = items_by_id.get(&t.item_id);
        let rings: Vec<&Vec<[f64; 2]>> = match item {
            Some(it) => {
                let mut r = vec![&it.coords];
                r.extend(it.holes.iter());
                r
            }
            None => continue,
        };
        let ring_strs: Vec<String> = rings
            .iter()
            .filter(|r| r.len() > 2)
            .map(|ring| {
                format!(
                    "M{}Z",
                    ring.iter()
                        .map(|p| format!("{} {}", py_fixed(p[0] * unit_scale, 3), py_fixed(p[1] * unit_scale, 3)))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            })
            .collect();
        let d = ring_strs.join(" ");
        if d.is_empty() {
            continue;
        }
        let color = t
            .color
            .clone()
            .or_else(|| item.and_then(|i| i.color.clone()))
            .unwrap_or_else(|| FALLBACK_PART_COLOR.to_string());
        let deg = t.angle * 180.0 / std::f64::consts::PI;
        parts.push(format!(
            "<path d=\"{d}\" transform=\"translate({} {}) scale(1 -1) rotate({})\" fill=\"{color}\" fill-opacity=\"{}\" fill-rule=\"evenodd\" stroke=\"{color}\" stroke-width=\"{}\" />",
            py_fixed(t.x * unit_scale, 3),
            py_fixed(h - t.y * unit_scale, 3),
            py_fixed(deg, 3),
            py_str(FILL_OPACITY_LAYOUT),
            py_str(stroke_width),
        ));
    }

    parts.push("</svg>".to_string());
    parts.join("\n")
}

/// `shade(hex, factor)` — colors.py.
pub fn shade(hex_color: &str, factor: f64) -> String {
    let r = u8::from_str_radix(&hex_color[1..3], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex_color[3..5], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex_color[5..7], 16).unwrap_or(0);
    format!(
        "#{:02X}{:02X}{:02X}",
        (255.min((r as f64 * factor) as i32)) as u8,
        (255.min((g as f64 * factor) as i32)) as u8,
        (255.min((b as f64 * factor) as i32)) as u8,
    )
}

/// svg_generator.build_svg_string — preview d'import (opacité 0.18, trous
/// pointillés, contours rouges des entités sources aplatis à 0.1).
/// `inner` = pour chaque part, les polylignes sources aplatie (déjà en mm),
/// dans l'ordre des handles (le Python itère entities dans l'ordre du doc).
pub fn build_preview_svg(
    closed_parts: &[Item],
    inner_flattened: &[Vec<Vec<[f64; 2]>>],
) -> String {
    let all: Vec<&[f64; 2]> = closed_parts.iter().flat_map(|p| p.coords.iter()).collect();
    let min_x = all.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
    let min_y = all.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
    let max_x = all.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max);
    let max_y = all.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max);
    let width = max_x - min_x;
    let height = max_y - min_y;
    let stroke_width = width.min(height) * 0.002;

    let mut s = String::from("<?xml version='1.0' encoding='utf-8'?>\n");
    s.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}mm\" height=\"{}mm\" viewBox=\"0 0 {} {}\">\n",
        py_str(width), py_str(height), py_str(width), py_str(height)
    ));

    for (pi, part) in closed_parts.iter().enumerate() {
        let color = part.color.clone().unwrap_or_else(|| FALLBACK_PREVIEW_COLOR.to_string());
        let wc: String = part
            .coords
            .iter()
            .map(|c| format!("{} {}", py_str(c[0] - min_x), py_str(c[1] - min_y)))
            .collect::<Vec<_>>()
            .join(" ");
        s.push_str(&format!(
            "<path d=\"M {wc} Z\" fill=\"{color}\" fill-opacity=\"{}\" stroke=\"{color}\" stroke-width=\"{}\" />",
            py_str(FILL_OPACITY_PREVIEW),
            py_str(stroke_width)
        ));
        let hole_color = if part.color.is_some() {
            shade(&part.color.clone().unwrap(), 0.6)
        } else {
            LEGACY_HOLE_COLOR.to_string()
        };
        for hole in &part.holes {
            let hc: String = hole
                .iter()
                .map(|c| format!("{} {}", py_str(c[0] - min_x), py_str(c[1] - min_y)))
                .collect::<Vec<_>>()
                .join(" ");
            s.push_str(&format!(
                "<path d=\"M {hc} Z\" fill=\"none\" stroke=\"{hole_color}\" stroke-width=\"{}\" stroke-dasharray=\"{} {}\" />",
                py_str(stroke_width),
                py_str(stroke_width * 4.0),
                py_str(stroke_width * 2.0)
            ));
        }
        if let Some(inner) = inner_flattened.get(pi) {
            for poly in inner {
                let ic: String = poly
                    .iter()
                    .map(|c| format!("{} {}", py_str(c[0] - min_x), py_str(c[1] - min_y)))
                    .collect::<Vec<_>>()
                    .join(" ");
                s.push_str(&format!(
                    "<path d=\"M {ic} Z\" fill=\"none\" stroke=\"#FF0000\" stroke-width=\"{}\" />",
                    py_str(stroke_width)
                ));
            }
        }
    }
    s.push_str("</svg>\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shade_matches_python() {
        // colors.py : int() tronque, 235*0.6 == 141.0 exactement.
        assert_eq!(shade("#2563EB", 0.6), "#163B8D");
    }

    #[test]
    fn colored_sheet_header_byte_stable() {
        let mut items = HashMap::new();
        items.insert(
            "i1".into(),
            Item {
                coords: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 5.0]],
                holes: vec![],
                color: Some("#2563EB".into()),
            },
        );
        let t = vec![Placement {
            item_id: "i1".into(),
            file_slug: "f".into(),
            handles: vec![],
            angle: 0.0,
            x: 5.0,
            y: 5.0,
            color: None,
        }];
        let svg = build_colored_sheet_svg(&t, &items, 300.0, 150.0, 1.0, "mm");
        // La validation byte-level réelle se fait contre le Python dans le
        // harnais (parity/svg). Ici : structure + format width/height.
        assert!(svg.contains("width=\"300.0mm\""), "{svg}");
        assert!(svg.contains("height=\"150.0mm\""), "{svg}");
        assert!(svg.contains("fill-opacity=\"0.35\""), "{svg}");
    }
}
