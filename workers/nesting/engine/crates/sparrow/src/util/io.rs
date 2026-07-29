use anyhow::{Context, Result};
use jagua_rs::probs::spp::io::ext_repr::{ExtSPInstance, ExtSPSolution};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone)]
pub struct ExtSPOutput {
    #[serde(flatten)]
    pub instance: ExtSPInstance,
    pub solution: ExtSPSolution,
}

pub fn write_json(json: &impl Serialize, path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("could not create parent directory for json output")?;
    }
    let file = File::create(path)?;
    serde_json::to_writer_pretty(file, json)?;
    Ok(())
}

pub fn read_spp_input(path: &Path) -> Result<(ExtSPInstance, Option<ExtSPSolution>)> {
    let input_str = fs::read_to_string(path).context("could not read input file")?;
    //try parsing a full output (instance + solution)
    match serde_json::from_str::<ExtSPOutput>(&input_str) {
        Ok(ext_output) => {
            Ok((ext_output.instance, Some(ext_output.solution)))
        }
        Err(_) => {
            //try parsing just the instance
            let ext_instance = serde_json::from_str::<ExtSPInstance>(&input_str)
                .context("could not parse instance from input file")?;
            Ok((ext_instance, None))
        }
    }
}
