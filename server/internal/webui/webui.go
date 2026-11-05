// Package webui embeds the built SolidJS SPA so the server ships as a single
// binary. The dist/ tree is produced by `make web-build`; a committed
// .gitkeep keeps the embed pattern valid in a fresh checkout.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Assets returns the embedded SPA file tree rooted at index.html.
func Assets() (fs.FS, error) {
	return fs.Sub(dist, "dist")
}
