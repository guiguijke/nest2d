#![cfg_attr(feature = "simd", feature(portable_simd))]
#![allow(const_item_mutation)]
#![allow(unused_imports)]

use jagua_rs::Instant;
use numfmt::{Formatter, Precision, Scales};
use std::sync::LazyLock;

pub mod optimizer;
pub mod quantify;
pub mod sample;
pub mod util;
pub mod config;
pub mod eval;
pub mod consts;

pub static EPOCH: LazyLock<Instant> = LazyLock::new(Instant::now);

static FMT: fn() -> Formatter = || -> Formatter {
    Formatter::new()
        .scales(Scales::short())
        .precision(Precision::Significance(3))
};
