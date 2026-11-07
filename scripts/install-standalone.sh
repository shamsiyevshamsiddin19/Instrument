#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_root="$project_root/standalone/quick-translate@shamsiddin"
data_root="${XDG_DATA_HOME:-$HOME/.local/share}"
install_root="$data_root/gnome-shell/extensions/quick-translate@shamsiddin"

mkdir -p "$install_root"
cp -a "$source_root/." "$install_root/"
glib-compile-schemas --strict "$install_root/schemas"

echo "Installed: $install_root"
echo "Log Out and Log In, then enable quick-translate@shamsiddin if needed."
