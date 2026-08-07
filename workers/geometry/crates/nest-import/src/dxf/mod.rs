//! DXF group-code reader for the REAL entity subset (never the full spec —
//! docs/PIPELINE-MAP.md §2). Mirrors ezdxf.recover behavior: lenient parsing,
//! malformed entities skipped (never a crash), duplicate handles tolerated.

pub mod decompose;
pub mod entities;
pub mod flatten;

use crate::units;
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
        })
    }
}

/// Modelspace flattened to primitive entities: cleanup (TEXT/MTEXT/IMAGE/
/// SOLID removed), blocks resolved, units normalized to mm — the exact twin
/// of read_dxf_file + recursive_decompose + scale. Returns (primitives,
/// skipped-entity warnings). The primitive count IS the modelspace entity
/// count the Python pipeline gates on (MAX_ENTITY_LIMIT).
pub fn flattened_modelspace(doc: &Document) -> (Vec<flatten::Primitive>, Vec<String>) {
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
    let flat = decompose::decompose(&kept, &doc.blocks);

    // Units: decompose FIRST, then uniform scale (AGENTS #26).
    let (factor, unknown) = units::factor_to_mm(doc.source_insunits);
    if unknown {
        warnings.push(format!(
            "unknown $INSUNITS={} — assuming millimeters",
            doc.source_insunits
        ));
    }
    let mut out = Vec::with_capacity(flat.len());
    for p in flat {
        out.push(if factor != 1.0 { p.scaled(factor) } else { p });
    }
    (out, warnings)
}
