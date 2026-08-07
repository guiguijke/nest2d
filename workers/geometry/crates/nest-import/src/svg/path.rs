//! SVG path-data parser + flattening — SVGLexicalParser / Path /
//! svg_to_drawing._flatten_path twins. The tokenizer replicates svgelements'
//! regex cursor (num_re / flag_re anchored at pos, inline_close on z/Z).

use super::segment::{ArcSeg, Seg};

type Pt = [f64; 2];

const FLATTEN_STEP_PX: f64 = 0.5;
const MAX_POINTS_PER_SEGMENT: usize = 512;

// ------------------------------------------------------------ tokenizer

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    /// z/Z rencontré là où un nombre était attendu (inline_close).
    Close,
}

struct Lexer<'a> {
    s: &'a [u8],
    pos: usize,
}

impl<'a> Lexer<'a> {
    fn new(s: &'a str) -> Lexer<'a> {
        Lexer { s: s.as_bytes(), pos: 0 }
    }

    fn skip_commawsp(&mut self) {
        while self.pos < self.s.len() {
            match self.s[self.pos] {
                b' ' | b',' | b'\t' | b'\n' | 0x0C | b'\r' => self.pos += 1,
                _ => break,
            }
        }
    }

    /// PATTERN_FLOAT anchored at pos (after commawsp). A z/Z does NOT get
    /// consumed (svgelements returns None and lets _command() read it
    /// later) — it only arms the inline_close marker.
    fn number(&mut self) -> Option<Tok> {
        loop {
            self.skip_commawsp();
            if self.pos >= self.s.len() {
                return None;
            }
            let c = self.s[self.pos];
            if c == b'z' || c == b'Z' {
                return Some(Tok::Close); // non consommé
            }
            let start = self.pos;
            let mut i = self.pos;
            if i < self.s.len() && (self.s[i] == b'+' || self.s[i] == b'-') {
                i += 1;
            }
            let mut digits = 0;
            while i < self.s.len() && self.s[i].is_ascii_digit() {
                i += 1;
                digits += 1;
            }
            if i < self.s.len() && self.s[i] == b'.' {
                // \.? requires digits after only if dot present in pattern
                // ([0-9]*\.?[0-9]+): "5." ne matche que "5".
                let mut j = i + 1;
                let mut frac = 0;
                while j < self.s.len() && self.s[j].is_ascii_digit() {
                    j += 1;
                    frac += 1;
                }
                if frac > 0 {
                    i = j;
                    digits += frac;
                }
            }
            if digits == 0 {
                self.pos = start;
                return None;
            }
            if i < self.s.len() && (self.s[i] == b'e' || self.s[i] == b'E') {
                let mut j = i + 1;
                if j < self.s.len() && (self.s[j] == b'+' || self.s[j] == b'-') {
                    j += 1;
                }
                let mut ed = 0;
                while j < self.s.len() && self.s[j].is_ascii_digit() {
                    j += 1;
                    ed += 1;
                }
                if ed > 0 {
                    i = j;
                }
            }
            let text = std::str::from_utf8(&self.s[start..i]).ok()?;
            self.pos = i;
            return Some(Tok::Num(text.parse().unwrap_or(f64::NAN)));
        }
    }

    /// _more() twin: peek — true iff a FLOAT follows (commawsp consumed,
    /// number NOT consumed; z/command letter → false, nothing consumed but
    /// the commawsp).
    fn more(&mut self) -> bool {
        self.skip_commawsp();
        if self.pos >= self.s.len() {
            return false;
        }
        let c = self.s[self.pos];
        if c == b'z' || c == b'Z' {
            return false;
        }
        c.is_ascii_digit() || c == b'+' || c == b'-' || c == b'.'
    }

    fn flag(&mut self) -> Option<bool> {
        self.skip_commawsp();
        if self.pos >= self.s.len() {
            return None;
        }
        match self.s[self.pos] {
            b'0' => {
                self.pos += 1;
                Some(false)
            }
            b'1' => {
                self.pos += 1;
                Some(true)
            }
            _ => None,
        }
    }

    fn command(&mut self) -> Option<char> {
        self.skip_commawsp();
        if self.pos >= self.s.len() {
            return None;
        }
        let c = self.s[self.pos] as char;
        if "MmZzLlHhVvCcSsQqTtAa".contains(c) {
            self.pos += 1;
            Some(c)
        } else {
            None
        }
    }
}

// ------------------------------------------------------------ path model

/// Path = segment list with current/z point tracking (Path callbacks twin).
#[derive(Default)]
pub struct PathBuf {
    pub segs: Vec<Seg>,
    current: Option<Pt>,
    z_point: Option<Pt>,
}

impl PathBuf {
    fn push(&mut self, s: Seg) {
        // track current/z like Path.append + current_point/z_point
        match &s {
            Seg::Move { end, .. } => {
                self.current = Some(*end);
                self.z_point = Some(*end);
            }
            Seg::Line { end, .. }
            | Seg::Quad { end, .. }
            | Seg::Cubic { end, .. }
            | Seg::Close { end, .. } => self.current = Some(*end),
            Seg::Arc(a) => self.current = Some(a.end),
        }
        self.segs.push(s);
    }

    fn cur(&self) -> Pt {
        self.current.unwrap_or([0.0, 0.0])
    }

    fn smooth_point(&self) -> Pt {
        let cur = self.cur();
        match self.segs.last() {
            Some(Seg::Quad { control, .. }) => reflect(*control, cur),
            Some(Seg::Cubic { control2, .. }) => reflect(*control2, cur),
            _ => cur,
        }
    }
}

fn reflect(p: Pt, across: Pt) -> Pt {
    // Point.reflected_across: 2*across - p
    [2.0 * across[0] - p[0], 2.0 * across[1] - p[1]]
}

/// Parse path data (d attribute) — SVGLexicalParser twin: parameter loops
/// exit when the next token is not a number (z and command letters are NOT
/// consumed), a bare z where a coordinate is expected substitutes z_point
/// (inline_close), and a truncated parameter aborts the parse keeping the
/// partial path (svgelements raises → on_error="ignore" keeps the prefix).
pub fn parse_path(d: &str) -> PathBuf {
    let mut lx = Lexer::new(d);
    let mut path = PathBuf::default();

    // Coordinate pair; relative adds current_point. Tok::Close → z_point
    // (inline_close). Truncated pair → abort (ValueError twin).
    macro_rules! coord {
        ($rel:expr) => {{
            match lx.number() {
                Some(Tok::Num(x)) => match lx.number() {
                    Some(Tok::Num(y)) => {
                        let mut p = [x, y];
                        if $rel {
                            let c = path.cur();
                            p = [p[0] + c[0], p[1] + c[1]];
                        }
                        Some(p)
                    }
                    _ => return path,
                },
                Some(Tok::Close) => {
                    lx.pos += 1; // le z est consommé par l'appelant
                    path.z_point
                }
                None => None,
            }
        }};
    }

    loop {
        let Some(cmd) = lx.command() else { break };
        let rel = cmd.is_lowercase();
        match cmd.to_ascii_uppercase() {
            'M' => {
                match coord!(rel) {
                    Some(p) => {
                        let start = path.current;
                        path.push(Seg::Move { start, end: p });
                    }
                    None => return path, // M sans coordonnée = ValueError
                }
                while lx.more() {
                    match coord!(rel) {
                        Some(p) => {
                            let start = path.cur();
                            path.push(Seg::Line { start, end: p });
                        }
                        None => return path,
                    }
                }
            }
            'L' => loop {
                match coord!(rel) {
                    Some(p) => {
                        let start = path.cur();
                        path.push(Seg::Line { start, end: p });
                    }
                    None => return path,
                }
                if !lx.more() {
                    break;
                }
            },
            'H' => loop {
                match lx.number() {
                    Some(Tok::Num(x)) => {
                        let c = path.cur();
                        let end = if rel { [c[0] + x, c[1]] } else { [x, c[1]] };
                        path.push(Seg::Line { start: c, end });
                    }
                    Some(Tok::Close) => {
                        lx.pos += 1;
                        if let Some(z) = path.z_point {
                            let c = path.cur();
                            path.push(Seg::Line { start: c, end: z });
                        }
                    }
                    None => return path,
                }
                if !lx.more() {
                    break;
                }
            },
            'V' => loop {
                match lx.number() {
                    Some(Tok::Num(y)) => {
                        let c = path.cur();
                        let end = if rel { [c[0], c[1] + y] } else { [c[0], y] };
                        path.push(Seg::Line { start: c, end });
                    }
                    Some(Tok::Close) => {
                        lx.pos += 1;
                        if let Some(z) = path.z_point {
                            let c = path.cur();
                            path.push(Seg::Line { start: c, end: z });
                        }
                    }
                    None => return path,
                }
                if !lx.more() {
                    break;
                }
            },
            'C' => loop {
                let (Some(c1), Some(c2), Some(e)) =
                    (coord!(rel), coord!(rel), coord!(rel))
                else {
                    return path;
                };
                let start = path.cur();
                path.push(Seg::Cubic { start, control1: c1, control2: c2, end: e });
                if !lx.more() {
                    break;
                }
            },
            'S' => loop {
                let (Some(c2), Some(e)) = (coord!(rel), coord!(rel)) else {
                    return path;
                };
                let start = path.cur();
                let c1 = path.smooth_point();
                path.push(Seg::Cubic { start, control1: c1, control2: c2, end: e });
                if !lx.more() {
                    break;
                }
            },
            'Q' => loop {
                let (Some(c), Some(e)) = (coord!(rel), coord!(rel)) else {
                    return path;
                };
                let start = path.cur();
                path.push(Seg::Quad { start, control: c, end: e });
                if !lx.more() {
                    break;
                }
            },
            'T' => loop {
                match coord!(rel) {
                    Some(e) => {
                        let start = path.cur();
                        let c = path.smooth_point();
                        path.push(Seg::Quad { start, control: c, end: e });
                    }
                    None => return path,
                }
                if !lx.more() {
                    break;
                }
            },
            'A' => loop {
                let (
                    Some(Tok::Num(rx)),
                    Some(Tok::Num(ry)),
                    Some(Tok::Num(rot)),
                    Some(large),
                    Some(sweep),
                ) = (
                    lx.number(),
                    lx.number(),
                    lx.number(),
                    lx.flag(),
                    lx.flag(),
                )
                else {
                    return path;
                };
                match coord!(rel) {
                    Some(e) => {
                        let start = path.cur();
                        path.push(Seg::Arc(ArcSeg::from_svg(
                            start,
                            rx.abs(),
                            ry.abs(),
                            rot,
                            large,
                            sweep,
                            e,
                        )));
                    }
                    None => return path,
                }
                if !lx.more() {
                    break;
                }
            },
            'Z' => {
                let start = path.cur();
                let end = path.z_point.unwrap_or(start);
                path.push(Seg::Close { start, end });
            }
            _ => break,
        }
    }
    path
}

// ------------------------------------------------------------ flattening

/// _segment_points twin: lines contribute endpoints; curves sample
/// n = clamp(2, ceil(len/0.5)+1, 512) uniform-t points.
fn segment_points(seg: &Seg) -> Vec<Pt> {
    match seg {
        Seg::Line { start, end } => vec![*start, *end],
        Seg::Move { .. } | Seg::Close { .. } => Vec::new(),
        _ => {
            let length = seg.length();
            let n = (2usize).max(MAX_POINTS_PER_SEGMENT.min(
                (length / FLATTEN_STEP_PX).ceil() as i64 as usize + 1,
            ));
            (0..n).map(|i| seg.point(i as f64 / (n - 1) as f64)).collect()
        }
    }
}

/// _flatten_path twin: yields (points px y-down, closed) per subpath.
/// Subpaths split on Move/Close (as_subpaths).
pub fn flatten_path(path: &PathBuf) -> Vec<(Vec<Pt>, bool)> {
    let mut out = Vec::new();
    let mut points: Vec<Pt> = Vec::new();
    let mut closed = false;
    let flush = |points: &mut Vec<Pt>, closed: bool, out: &mut Vec<(Vec<Pt>, bool)>| {
        if points.len() >= 2 {
            out.push((std::mem::take(points), closed));
        } else {
            points.clear();
        }
    };
    for seg in &path.segs {
        match seg {
            Seg::Move { .. } => {
                flush(&mut points, closed, &mut out);
                closed = false;
            }
            Seg::Close { .. } => {
                closed = true;
                flush(&mut points, closed, &mut out);
                closed = false;
            }
            _ => {
                let seg_pts = segment_points(seg);
                let mut seg_pts = seg_pts.as_slice();
                if !points.is_empty() && !seg_pts.is_empty() {
                    seg_pts = &seg_pts[1..];
                }
                points.extend_from_slice(seg_pts);
            }
        }
    }
    flush(&mut points, closed, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rect_path() {
        let p = parse_path("M 0 0 L 10 0 L 10 5 L 0 5 Z");
        assert_eq!(p.segs.len(), 5);
        let subs = flatten_path(&p);
        assert_eq!(subs.len(), 1);
        assert!(subs[0].1);
        assert_eq!(subs[0].0.len(), 4); // 3 lignes, joints dédupliqués
    }

    #[test]
    fn relative_and_implicit_lineto() {
        let p = parse_path("m 10 10 5 0 0 5 z");
        let subs = flatten_path(&p);
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].0[0], [10.0, 10.0]);
        assert_eq!(subs[0].0[1], [15.0, 10.0]);
        assert_eq!(subs[0].0[2], [15.0, 15.0]);
        assert!(subs[0].1);
    }

    #[test]
    fn arc_flags_glued() {
        // Flags collés au nombre suivant, notation SVG compacte.
        let p = parse_path("M 0 0 A 20 20 0 0130 40");
        assert!(matches!(p.segs[1], Seg::Arc(_)));
    }

    #[test]
    fn smooth_cubic_reflects() {
        let p = parse_path("M 0 0 C 10 10 20 10 30 0 S 50 -10 60 0");
        if let Seg::Cubic { control1, .. } = p.segs[2] {
            // reflection de control2 (20,10) autour de (30,0) → (40,-10)
            assert_eq!(control1, [40.0, -10.0]);
        } else {
            panic!("expected cubic");
        }
    }
}
