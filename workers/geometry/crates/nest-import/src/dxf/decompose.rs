//! INSERT resolution (ezdxf recursive_decompose twin): block references are
//! replaced by their member primitives with the reference transform applied —
//! BEFORE unit scaling (AGENTS #26). Nested INSERTs recurse; negative/mirror
//! scales follow ezdxf's angle handling; non-uniform scale turns ARC/CIRCLE
//! into ELLIPSE (ezdxf's Ellipse.from_arc path).

use super::entities::{Block, Entity};
use super::flatten::Primitive;

/// 2×2 matrix + translation (row-major [[a,b],[c,d]]).
#[derive(Debug, Clone, Copy)]
struct Affine {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    tx: f64,
    ty: f64,
}

impl Affine {
    fn identity() -> Self {
        Self { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: 0.0, ty: 0.0 }
    }
    fn apply(&self, p: [f64; 2]) -> [f64; 2] {
        [
            self.a * p[0] + self.b * p[1] + self.tx,
            self.c * p[0] + self.d * p[1] + self.ty,
        ]
    }
    /// self ∘ other (apply other first).
    fn then(&self, other: &Affine) -> Affine {
        Affine {
            a: self.a * other.a + self.b * other.c,
            b: self.a * other.b + self.b * other.d,
            c: self.c * other.a + self.d * other.c,
            d: self.c * other.b + self.d * other.d,
            tx: self.a * other.tx + self.b * other.ty + self.tx,
            ty: self.c * other.tx + self.d * other.ty + self.ty,
        }
    }
    fn apply_dir(&self, p: [f64; 2]) -> [f64; 2] {
        [
            self.a * p[0] + self.b * p[1],
            self.c * p[0] + self.d * p[1],
        ]
    }
}

/// INSERT transform (ezdxf Insert.matrix44, default OCS):
/// M = S(xs,ys) ∘ R(rotation) ; t = insert − M·base_point.
fn insert_affine(block: &Block, at: [f64; 2], xs: f64, ys: f64, rotation_deg: f64) -> Affine {
    let theta = rotation_deg * (std::f64::consts::PI / 180.0);
    let (s, c) = libm::sincos(theta);
    // S * R
    let a = xs * c;
    let b = -xs * s;
    let cc = ys * s;
    let d = ys * c;
    let bx = a * block.base[0] + b * block.base[1];
    let by = cc * block.base[0] + d * block.base[1];
    Affine {
        a,
        b,
        c: cc,
        d,
        tx: at[0] - bx,
        ty: at[1] - by,
    }
}

pub fn decompose(entities: &[Entity], blocks: &[Block]) -> Vec<Primitive> {
    let mut out = Vec::new();
    decompose_into(entities, blocks, Affine::identity(), &mut out);
    out
}

/// INSERT resolution at the ENTITY level (J-090): same recursion as
/// `decompose`, but keeps the full entity payload (bulges, color, layer) for
/// the canonical DXF rebuild — handles are (re)assigned downstream
/// (dxf/canonical.rs), mirroring ezdxf's fresh sequence on the rebuilt doc.
pub fn decompose_to_entities(entities: &[Entity], blocks: &[Block]) -> Vec<Entity> {
    let mut out = Vec::new();
    decompose_entities_into(entities, blocks, Affine::identity(), &mut out);
    out
}

fn decompose_into(entities: &[Entity], blocks: &[Block], m: Affine, out: &mut Vec<Primitive>) {
    for e in entities {
        match e {
            Entity::Insert(ins) => {
                if let Some(block) = blocks.iter().find(|b| b.name == ins.block) {
                    let local = insert_affine(block, ins.at, ins.xscale, ins.yscale, ins.rotation);
                    decompose_into(&block.entities, blocks, m.then(&local), out);
                }
                // Missing block definition: ezdxf raises — recover skips.
            }
            _ => out.push(apply(e, m)),
        }
    }
}

fn decompose_entities_into(entities: &[Entity], blocks: &[Block], m: Affine, out: &mut Vec<Entity>) {
    for e in entities {
        match e {
            Entity::Insert(ins) => {
                if let Some(block) = blocks.iter().find(|b| b.name == ins.block) {
                    let local = insert_affine(block, ins.at, ins.xscale, ins.yscale, ins.rotation);
                    decompose_entities_into(&block.entities, blocks, m.then(&local), out);
                }
            }
            _ => out.push(transform_entity(e, m)),
        }
    }
}

/// Applies the affine map to one entity, keeping the full payload (common,
/// bulges, knots/weights). `apply` below is then a pure geometry projection
/// (`primitive_of`) of this — SINGLE implementation of the transform math,
/// so the nesting rings and the canonical entities can never drift apart.
/// Bit-identical to the former direct mapping (same expressions, same order).
fn transform_entity(e: &Entity, m: Affine) -> Entity {
    match e {
        Entity::Line(l) => Entity::Line(super::entities::Line {
            start: m.apply(l.start),
            end: m.apply(l.end),
            common: l.common.clone(),
        }),
        Entity::LwPolyline(p) => Entity::LwPolyline(super::entities::LwPolyline {
            points: p.points.iter().map(|&pt| m.apply(pt)).collect(),
            bulges: p.bulges.clone(),
            closed: p.closed,
            common: p.common.clone(),
        }),
        Entity::Polyline(p) => Entity::Polyline(super::entities::Polyline {
            points: p.points.iter().map(|&pt| m.apply(pt)).collect(),
            closed: p.closed,
            common: p.common.clone(),
            vertex_handles: p.vertex_handles.clone(),
            seqend_handle: p.seqend_handle.clone(),
        }),
        Entity::Point(p) => Entity::Point(super::entities::Point {
            at: m.apply(p.at),
            common: p.common.clone(),
        }),
        Entity::Circle(c) => circle_entity(m.apply(c.center), c.radius, &m, &c.common),
        Entity::Arc(a) => arc_entity(m.apply(a.center), a.radius, a.start_angle, a.end_angle, &m, &a.common),
        Entity::Ellipse(el) => Entity::Ellipse(super::entities::Ellipse {
            center: m.apply(el.center),
            major: m.apply_dir(el.major),
            ratio: el.ratio,
            start_param: el.start_param,
            end_param: el.end_param,
            common: el.common.clone(),
        }),
        Entity::Spline(sp) => Entity::Spline(super::entities::Spline {
            degree: sp.degree,
            knots: sp.knots.clone(),
            control: sp.control.iter().map(|&pt| m.apply(pt)).collect(),
            weights: sp.weights.clone(),
            common: sp.common.clone(),
        }),
        Entity::Unsupported(kind) => Entity::Unsupported(kind.clone()),
        // INSERT never reaches here — resolved by decompose_*_into.
        Entity::Insert(ins) => Entity::Insert(ins.clone()),
    }
}

/// Geometry projection Entity → Primitive (no transform — identity map).
/// The nesting rings only ever see this projection (bulges dropped, D-IMP-8).
pub fn primitive_of(e: &Entity) -> Primitive {
    match e {
        Entity::Line(l) => Primitive::Line {
            start: l.start,
            end: l.end,
            handle: l.common.handle.clone(),
            layer: l.common.layer.clone(),
        },
        Entity::LwPolyline(p) => Primitive::Polyline {
            points: p.points.clone(),
            closed: p.closed,
            handle: p.common.handle.clone(),
            layer: p.common.layer.clone(),
        },
        Entity::Polyline(p) => Primitive::Polyline {
            points: p.points.clone(),
            closed: p.closed,
            handle: p.common.handle.clone(),
            layer: p.common.layer.clone(),
        },
        Entity::Point(p) => Primitive::Point {
            at: p.at,
            handle: p.common.handle.clone(),
            layer: p.common.layer.clone(),
        },
        Entity::Circle(c) => Primitive::Circle {
            center: c.center,
            radius: c.radius,
            handle: c.common.handle.clone(),
            layer: c.common.layer.clone(),
        },
        Entity::Arc(a) => Primitive::Arc {
            center: a.center,
            radius: a.radius,
            start_angle: a.start_angle,
            end_angle: a.end_angle,
            handle: a.common.handle.clone(),
            layer: a.common.layer.clone(),
        },
        Entity::Ellipse(el) => Primitive::Ellipse {
            center: el.center,
            major: el.major,
            ratio: el.ratio,
            start_param: el.start_param,
            end_param: el.end_param,
            handle: el.common.handle.clone(),
            layer: el.common.layer.clone(),
        },
        Entity::Spline(sp) => Primitive::Spline {
            degree: sp.degree,
            knots: sp.knots.clone(),
            control: sp.control.clone(),
            weights: sp.weights.clone(),
            handle: sp.common.handle.clone(),
            layer: sp.common.layer.clone(),
        },
        Entity::Unsupported(kind) => Primitive::Unsupported(kind.clone()),
        Entity::Insert(_) => Primitive::Unsupported("INSERT".into()),
    }
}

/// Applies the affine map to one entity's geometry (entity-level, like ezdxf
/// entity.transform), projected to a Primitive — `primitive_of(transform_entity)`.
fn apply(e: &Entity, m: Affine) -> Primitive {
    primitive_of(&transform_entity(e, m))
}

/// CIRCLE under an affine map (entity level): uniform scale stays a Circle
/// (radius × s) ; non-uniform converts to an ellipse (ezdxf behavior).
fn circle_entity(center: [f64; 2], radius: f64, m: &Affine, common: &super::entities::Common) -> Entity {
    let sx = (m.a * m.a + m.c * m.c).sqrt();
    let sy = (m.b * m.b + m.d * m.d).sqrt();
    let uniform = (sx - sy).abs() <= 1e-9 * sx.max(1.0) && m.a * m.b + m.c * m.d == 0.0;
    if uniform {
        Entity::Circle(super::entities::Circle {
            center,
            radius: radius * sx,
            common: common.clone(),
        })
    } else {
        let major = m.apply_dir([radius, 0.0]);
        let minor = m.apply_dir([0.0, radius]);
        let ratio = (minor[0] * minor[0] + minor[1] * minor[1]).sqrt()
            / (major[0] * major[0] + major[1] * major[1]).sqrt();
        Entity::Ellipse(super::entities::Ellipse {
            center,
            major,
            ratio,
            start_param: 0.0,
            end_param: std::f64::consts::TAU,
            common: common.clone(),
        })
    }
}

/// ARC/CIRCLE under an affine map (entity level). Uniform scale: radius × s,
/// angles += θ. Non-uniform (or mirrored): converted to an ellipse (ezdxf).
fn arc_entity(
    center: [f64; 2],
    radius: f64,
    start_angle: f64,
    end_angle: f64,
    m: &Affine,
    common: &super::entities::Common,
) -> Entity {
    let sx = (m.a * m.a + m.c * m.c).sqrt();
    let sy = (m.b * m.b + m.d * m.d).sqrt();
    let uniform = (sx - sy).abs() <= 1e-9 * sx.max(1.0) && m.a * m.b + m.c * m.d == 0.0;
    if uniform {
        // Pure rotation+uniform scale: rotate angles by the map's rotation.
        let theta = libm::atan2(m.c, m.a).to_degrees();
        Entity::Arc(super::entities::Arc {
            center,
            radius: radius * sx,
            start_angle: start_angle + theta,
            end_angle: end_angle + theta,
            common: common.clone(),
        })
    } else {
        // ezdxf converts ARC/CIRCLE to ELLIPSE on non-uniform scale, then
        // transforms: major axis = (r,0) mapped by M, ratio preserved by the
        // minor axis mapped likewise.
        let major = m.apply_dir([radius, 0.0]);
        let minor = m.apply_dir([0.0, radius]);
        let ratio = (minor[0] * minor[0] + minor[1] * minor[1]).sqrt()
            / (major[0] * major[0] + major[1] * major[1]).sqrt();
        Entity::Ellipse(super::entities::Ellipse {
            center,
            major,
            ratio,
            start_param: start_angle * (std::f64::consts::PI / 180.0),
            end_param: end_angle * (std::f64::consts::PI / 180.0),
            common: common.clone(),
        })
    }
}
