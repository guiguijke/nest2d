use anyhow::{Context, Result};
use clap::Parser;
use nest_engine::run_json;
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

    let instance_str = std::fs::read_to_string(&cli.input)
        .with_context(|| format!("reading instance {}", cli.input.display()))?;
    let config_str = std::fs::read_to_string(&cli.config)
        .with_context(|| format!("reading config {}", cli.config.display()))?;

    std::fs::create_dir_all(&cli.output)
        .with_context(|| format!("creating output dir {}", cli.output.display()))?;

    let result = run_json(&cli.problem, &instance_str, &config_str).and_then(|out| {
        std::fs::write(
            cli.output.join("sol_instance.json"),
            serde_json::to_string_pretty(&out.sol_instance)?,
        )?;
        std::fs::write(
            cli.output.join("alternatives.json"),
            serde_json::to_string_pretty(&out.alternatives)?,
        )?;
        Ok(())
    });

    if let Err(e) = &result {
        // Machine-readable failure for the worker (in addition to the
        // non-zero exit code); details on stderr for humans.
        eprintln!("nest-engine failed: {e:#}");
        std::process::exit(1);
    }
    Ok(())
}
