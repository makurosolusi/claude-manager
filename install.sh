#!/bin/sh
# Installs the claude-manager binary from GitHub Releases (macOS and Linux).
#   curl -fsSL https://github.com/<owner>/claude-manager/releases/latest/download/install.sh | sh
# Env: CLAUDE_MANAGER_VERSION (default latest), CLAUDE_MANAGER_INSTALL_DIR (default ~/.local/bin).
set -eu

# TODO(release): set real owner/repo before first release (pending user)
DEFAULT_REPO="makurosolusi/claude-manager"
REPO="${CLAUDE_MANAGER_REPO:-$DEFAULT_REPO}"
DOWNLOAD_BASE="${CLAUDE_MANAGER_RELEASE_DOWNLOAD:-https://github.com}"
VERSION="${CLAUDE_MANAGER_VERSION:-latest}"
INSTALL_DIR="${CLAUDE_MANAGER_INSTALL_DIR:-$HOME/.local/bin}"
BIN="claude-manager"
SUMS="SHA256SUMS"

die() {
  echo "error: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "unsupported OS $(uname -s): claude-manager supports macOS and Linux" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported architecture $(uname -m): need x86_64 or arm64" ;;
esac
asset="$BIN-$os-$arch"

if [ "$VERSION" = latest ]; then
  url="$DOWNLOAD_BASE/$REPO/releases/latest/download"
else
  case "$VERSION" in v*) tag="$VERSION" ;; *) tag="v$VERSION" ;; esac
  url="$DOWNLOAD_BASE/$REPO/releases/download/$tag"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' INT TERM

curl -fsSL -o "$tmp/$asset" "$url/$asset" || die "download failed: $url/$asset"
curl -fsSL -o "$tmp/$SUMS" "$url/$SUMS" || die "download failed: $url/$SUMS"

expected="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "$tmp/$SUMS")"
[ -n "$expected" ] || die "$asset is not listed in $url/$SUMS"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d ' ' -f 1)"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d ' ' -f 1)"
else
  die "need sha256sum or shasum to verify the download"
fi
if [ "$actual" != "$expected" ]; then
  rm -f "$tmp/$asset"
  die "checksum mismatch for $asset: expected $expected, got $actual"
fi

mkdir -p "$INSTALL_DIR"
chmod 755 "$tmp/$asset"
mv -f "$tmp/$asset" "$INSTALL_DIR/$BIN"
echo "installed $BIN to $INSTALL_DIR/$BIN"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "warning: $INSTALL_DIR is not in PATH; add: export PATH=\"$INSTALL_DIR:\$PATH\"" >&2 ;;
esac
