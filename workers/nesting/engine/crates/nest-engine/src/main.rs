mod bpp;
mod config;
mod gravity;
mod progress;
mod spp;

use anyhow::{Context, Result, bail};
use clap::Parser;
use config::EngineConfig;
use std::path::PathBuf;

/// Nest2D nesting engine.
///
/// File-based CLI (lbf conventions): reads an instance + engine config,
/// optimizes, and writes sol_instance.json + alternatives.json to the output
/// directory. stdout carries ONLY JSON progress lines (one per line) for the
/// Python worker to relay; diagnostics go to stderr.
#[derive(Parser)]
#[command(name = "nest-engine", version, about)]
struct Cli {
    /// Path to the instance JSON file (jagua-rs external representation)
    #[arg(short = 'i', long)]
    input: PathBuf,

    /// Path to the engine config JSON file
    #[arg(short = 'c', long)]
    config: PathBuf,

    /// Output directory for sol_instance.json / alternatives.json
    #[arg(short = 's', long)]
    output: PathBuf,

    /// Problem type: spp (strip packing, single sheet type) or bpp (bin packing, multi-sheet)
    #[arg(short = 'p', long, value_parser = ["spp", "bpp"])]
    problem: String,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    let config_str = std::fs::read_to_string(&cli.config)
        .with_context(|| format!("reading config {}", cli.config.display()))?;
    let config: EngineConfig = serde_json::from_str(&config_str)
        .with_context(|| format!("parsing config {}", cli.config.display()))?;

    std::fs::create_dir_all(&cli.output)
        .with_context(|| format!("creating output dir {}", cli.output.display()))?;

    let result = match cli.problem.as_str() {
        "spp" => spp::run_spp(&cli.input, &cli.output, &config),
        "bpp" => bpp::run_bpp(&cli.input, &cli.output, &config),
        other => bail!("unsupported problem type: {other}"),
    };

    if let Err(e) = &result {
        // Machine-readable failure for the worker (in addition to the
        // non-zero exit code); details on stderr for humans.
        eprintln!("nest-engine failed: {e:#}");
        std::process::exit(1);
    }
    Ok(())
}
