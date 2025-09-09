use clap::{Parser, Subcommand};
use std::fs;
mod markdown;

#[derive(Parser)]
#[command(author, version, about)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run as CLI: convert input.md to output.html
    Cli { input: String, output: String },
    /// Run GUI editor
    Gui,
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Cli { input, output } => {
            let md = fs::read_to_string(&input).expect("Cannot read input file");
            let html = markdown::markdown_to_html(&md);
            fs::write(&output, html).expect("Cannot write output file");
            println!("Converted {} -> {}", input, output);
        }
        Commands::Gui => {
            gui::run_gui();
        }
    }
}

mod gui;
