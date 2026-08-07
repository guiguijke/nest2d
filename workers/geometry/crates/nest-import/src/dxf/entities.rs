//! Typed entities for the real subset (docs/PIPELINE-MAP.md §1.3).
//! Reader = lenient (ezdxf.recover parity): unknown group codes skipped,
//! malformed values defaulted, entities never abort the document.
//!
//! Protocol: each reader stops AT the (0, name) group that starts the next
//! entity and RETURNS it as lookahead — the caller re-dispatches it.

use super::{GroupReader, parse_f64};

pub type Lookahead = Option<(i32, String)>;

#[derive(Debug, Clone)]
pub enum Entity {
    Line(Line),
    LwPolyline(LwPolyline),
    Polyline(Polyline),
    Arc(Arc),
    Circle(Circle),
    Ellipse(Ellipse),
    Spline(Spline),
    Point(Point),
    Insert(Insert),
    /// Skipped entity (TEXT/MTEXT/IMAGE/SOLID/HATCH/unknown) — kept as a
    /// marker so entity_count matches the Python len(modelspace).
    Unsupported(String),
}

#[derive(Debug, Clone, Default)]
pub struct Common {
    pub handle: String,
    pub layer: String,
}

#[derive(Debug, Clone, Default)]
pub struct Line {
    pub start: [f64; 2],
    pub end: [f64; 2],
    pub common: Common,
}

#[derive(Debug, Clone, Default)]
pub struct LwPolyline {
    pub points: Vec<[f64; 2]>,
    pub closed: bool,
    pub common: Common,
}

#[derive(Debug, Clone, Default)]
pub struct Polyline {
    pub points: Vec<[f64; 2]>,
    pub closed: bool,
    pub common: Common,
}

#[derive(Debug, Clone, Default)]
pub struct Arc {
    pub center: [f64; 2],
    pub radius: f64,
    pub start_angle: f64, // degrees CCW
    pub end_angle: f64,
    pub common: Common,
}

#[derive(Debug, Clone, Default)]
pub struct Circle {
    pub center: [f64; 2],
    pub radius: f64,
    pub common: Common,
}

#[derive(Debug, Clone, Default)]
pub struct Ellipse {
    pub center: [f64; 2],
    /// Major axis endpoint RELATIVE to center.
    pub major: [f64; 2],
    pub ratio: f64,
    pub start_param: f64, // radians
    pub end_param: f64,
    pub common: Common,
}

#[derive(Debug, Clone, Default)]
pub struct Spline {
    pub degree: i32,
    pub knots: Vec<f64>,
    pub control: Vec<[f64; 2]>,
    pub weights: Vec<f64>,
    pub common: Common,
}

#[derive(Debug, Clone, Default)]
pub struct Point {
    pub at: [f64; 2],
    pub common: Common,
}

#[derive(Debug, Clone, Default)]
pub struct Insert {
    pub block: String,
    pub at: [f64; 2],
    pub xscale: f64,
    pub yscale: f64,
    pub rotation: f64, // degrees CCW
    pub common: Common,
}

#[derive(Debug, Clone, Default)]
pub struct Block {
    pub name: String,
    pub base: [f64; 2],
    pub entities: Vec<Entity>,
}

fn common_apply(common: &mut Common, code: i32, value: &str) {
    match code {
        5 => common.handle = value.trim().to_string(),
        8 => common.layer = value.trim().to_string(),
        _ => {}
    }
}

fn f(v: &str) -> f64 {
    parse_f64(v).unwrap_or(0.0)
}

/// Reads one entity. Returns the entity plus the lookahead group (the
/// (0, name) pair opening the NEXT entity), which the caller must dispatch.
pub fn read_entity<'a>(
    name: &str,
    mut r: GroupReader<'a>,
) -> (Option<Entity>, Lookahead, GroupReader<'a>) {
    let mut common = Common::default();
    let mut look: Lookahead = None;

    macro_rules! entity {
        ($e:expr) => {
            return (Some($e), look, r)
        };
    }

    match name {
        "LINE" => {
            let mut e = Line::default();
            while let Some((c, v)) = r.next() {
                if c == 0 { look = Some((0, v.trim().to_string())); break; }
                match c {
                    10 => e.start[0] = f(v),
                    20 => e.start[1] = f(v),
                    11 => e.end[0] = f(v),
                    21 => e.end[1] = f(v),
                    _ => common_apply(&mut common, c, v),
                }
            }
            e.common = common;
            entity!(Entity::Line(e))
        }
        "LWPOLYLINE" => {
            let mut e = LwPolyline::default();
            let mut pending_x: Option<f64> = None;
            while let Some((c, v)) = r.next() {
                if c == 0 { look = Some((0, v.trim().to_string())); break; }
                match c {
                    10 => pending_x = Some(f(v)),
                    20 => {
                        if let Some(x) = pending_x.take() {
                            e.points.push([x, f(v)]);
                        }
                    }
                    // 42 (bulge) deliberately ignored — D-IMP-8: straight
                    // chords, identical to Python's get_points(format="xy").
                    70 => e.closed = (v.trim().parse::<i32>().unwrap_or(0) & 1) != 0,
                    _ => common_apply(&mut common, c, v),
                }
            }
            e.common = common;
            entity!(Entity::LwPolyline(e))
        }
        "POLYLINE" => {
            // Legacy: header codes then VERTEX sub-entities until SEQEND.
            // Mesh vertices (flags 16/32/64) are skipped (ezdxf points() parity).
            let mut e = Polyline::default();
            let mut cur: Option<([f64; 2], i32)> = None;
            while let Some((c, v)) = r.next() {
                if c == 0 {
                    let tag = v.trim();
                    if let Some((pt, vflags)) = cur.take() {
                        if vflags & (16 | 32 | 64) == 0 {
                            e.points.push(pt);
                        }
                    }
                    if tag == "SEQEND" {
                        break;
                    }
                    if tag == "VERTEX" {
                        cur = Some(([0.0, 0.0], 0));
                    } else {
                        look = Some((0, tag.to_string()));
                        break;
                    }
                    continue;
                }
                match c {
                    10 => {
                        if let Some(mut cv) = cur.take() {
                            cv.0[0] = f(v);
                            cur = Some(cv);
                        }
                    }
                    20 => {
                        if let Some(mut cv) = cur.take() {
                            cv.0[1] = f(v);
                            cur = Some(cv);
                        }
                    }
                    70 => {
                        let flags = v.trim().parse::<i32>().unwrap_or(0);
                        if let Some(mut cv) = cur.take() {
                            cv.1 = flags;
                            cur = Some(cv);
                        } else {
                            e.closed = (flags & 1) != 0;
                        }
                    }
                    _ => common_apply(&mut common, c, v),
                }
            }
            e.common = common;
            entity!(Entity::Polyline(e))
        }
        "ARC" => {
            let mut e = Arc::default();
            while let Some((c, v)) = r.next() {
                if c == 0 { look = Some((0, v.trim().to_string())); break; }
                match c {
                    10 => e.center[0] = f(v),
                    20 => e.center[1] = f(v),
                    40 => e.radius = f(v),
                    50 => e.start_angle = f(v),
                    51 => e.end_angle = f(v),
                    _ => common_apply(&mut common, c, v),
                }
            }
            e.common = common;
            entity!(Entity::Arc(e))
        }
        "CIRCLE" => {
            let mut e = Circle::default();
            while let Some((c, v)) = r.next() {
                if c == 0 { look = Some((0, v.trim().to_string())); break; }
                match c {
                    10 => e.center[0] = f(v),
                    20 => e.center[1] = f(v),
                    40 => e.radius = f(v),
                    _ => common_apply(&mut common, c, v),
                }
            }
            e.common = common;
            entity!(Entity::Circle(e))
        }
        "ELLIPSE" => {
            let mut e = Ellipse { ratio: 1.0, ..Default::default() };
            while let Some((c, v)) = r.next() {
                if c == 0 { look = Some((0, v.trim().to_string())); break; }
                match c {
                    10 => e.center[0] = f(v),
                    20 => e.center[1] = f(v),
                    11 => e.major[0] = f(v),
                    21 => e.major[1] = f(v),
                    40 => e.ratio = f(v),
                    41 => e.start_param = f(v),
                    42 => e.end_param = f(v),
                    _ => common_apply(&mut common, c, v),
                }
            }
            e.common = common;
            entity!(Entity::Ellipse(e))
        }
        "SPLINE" => {
            let mut e = Spline::default();
            let mut n_knots = 0usize;
            let mut n_ctrl = 0usize;
            let mut pending_x: Option<f64> = None;
            while let Some((c, v)) = r.next() {
                if c == 0 { look = Some((0, v.trim().to_string())); break; }
                match c {
                    71 => e.degree = v.trim().parse().unwrap_or(3),
                    72 => n_knots = v.trim().parse().unwrap_or(0),
                    73 => n_ctrl = v.trim().parse().unwrap_or(0),
                    40 if e.knots.len() < n_knots => e.knots.push(f(v)),
                    41 if e.weights.len() < n_ctrl => e.weights.push(f(v)),
                    10 => pending_x = Some(f(v)),
                    20 => {
                        if let Some(x) = pending_x.take() {
                            e.control.push([x, f(v)]);
                        }
                    }
                    _ => common_apply(&mut common, c, v),
                }
            }
            e.common = common;
            entity!(Entity::Spline(e))
        }
        "POINT" => {
            let mut e = Point::default();
            while let Some((c, v)) = r.next() {
                if c == 0 { look = Some((0, v.trim().to_string())); break; }
                match c {
                    10 => e.at[0] = f(v),
                    20 => e.at[1] = f(v),
                    _ => common_apply(&mut common, c, v),
                }
            }
            e.common = common;
            entity!(Entity::Point(e))
        }
        "INSERT" => {
            let mut e = Insert { xscale: 1.0, yscale: 1.0, ..Default::default() };
            while let Some((c, v)) = r.next() {
                if c == 0 { look = Some((0, v.trim().to_string())); break; }
                match c {
                    2 => e.block = v.trim().to_string(),
                    10 => e.at[0] = f(v),
                    20 => e.at[1] = f(v),
                    41 => e.xscale = f(v),
                    42 => e.yscale = f(v),
                    50 => e.rotation = f(v),
                    _ => common_apply(&mut common, c, v),
                }
            }
            e.common = common;
            entity!(Entity::Insert(e))
        }
        other => {
            // TEXT/MTEXT/IMAGE/SOLID: removed by cleanup (counted like ezdxf).
            // HATCH: pattern fills become motif lines in Python — documented
            // divergence (PIPELINE-MAP §1.3), not a cutting input. Unknown
            // types: skip with warning parity, never crash.
            while let Some((c, v)) = r.next() {
                if c == 0 {
                    look = Some((0, v.trim().to_string()));
                    break;
                }
            }
            entity!(Entity::Unsupported(other.to_string()))
        }
    }
}

/// Reads a BLOCK definition (member entities until ENDBLK).
pub fn read_block<'a>(mut r: GroupReader<'a>) -> (Block, Lookahead, GroupReader<'a>) {
    let mut block = Block::default();
    let mut look: Lookahead = None;
    loop {
        let (c, v_owned) = match look.take() {
            Some(g) => g,
            None => match r.next() {
                Some((c, v)) => (c, v.to_string()),
                None => break,
            },
        };
        let v = v_owned.trim();
        match c {
            2 => block.name = v.to_string(),
            10 => block.base[0] = f(v),
            20 => block.base[1] = f(v),
            0 => {
                if v == "ENDBLK" {
                    break;
                }
                let (entity, look2, r2) = read_entity(v, r);
                r = r2;
                look = look2;
                if let Some(e) = entity {
                    block.entities.push(e);
                }
            }
            _ => {}
        }
    }
    (block, look, r)
}
