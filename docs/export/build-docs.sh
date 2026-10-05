#!/usr/bin/env sh
# Builds Agence JRi-styled .docx files from the Markdown sources in docs/.
# Usage: sh docs/export/build-docs.sh   (output in build/)
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$root"
mkdir -p build
gen() { # $1 = source .md, $2 = output .docx
  pandoc "$1" --from markdown --to docx \
    --reference-doc "$here/reference-jri.docx" \
    --lua-filter "$here/jri.lua" \
    --resource-path "$(dirname "$1")" \
    -o "build/$2"
  echo "build/$2"
}
gen docs/scoping.md TIMON-CAD-001-scoping.docx
gen docs/adr/0001-typescript-postgresql.md TIMON-ADR-001-language-and-database.docx
gen docs/adr/0002-target-architecture.md TIMON-ADR-002-target-architecture.docx
gen docs/adr/0003-environments-and-hosting.md TIMON-ADR-003-environments-and-hosting.docx
