// swift-tools-version:5.5

import PackageDescription

let package = Package(
  name: "tauri-plugin-documents",
  platforms: [
    .iOS(.v15)
  ],
  products: [
    .library(
      name: "tauri-plugin-documents",
      type: .static,
      targets: ["tauri-plugin-documents"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-documents",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
