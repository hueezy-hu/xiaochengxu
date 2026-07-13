class QRCode {
  constructor(options = {}) {
    this.canvasId = options.canvasId
    this.text = options.text || ''
    this.size = options.size || 220
    this.foreground = options.foreground || '#243329'
    this.background = options.background || '#FAF7EE'
  }

  makeCode(text) {
    this.text = text || this.text
  }

  draw(ctx) {
    if (!ctx) return
    const cells = 21
    const size = this.size
    const cell = size / cells
    ctx.setFillStyle(this.background)
    ctx.fillRect(0, 0, size, size)
    ctx.setFillStyle(this.foreground)
    for (let y = 0; y < cells; y += 1) {
      for (let x = 0; x < cells; x += 1) {
        const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13)
        const index = (x + y) % Math.max(1, this.text.length)
        const hash = (x * 17 + y * 31 + this.text.length * 13 + this.text.charCodeAt(index)) % 5
        if (finder || hash === 0 || hash === 2) ctx.fillRect(x * cell, y * cell, cell * 0.82, cell * 0.82)
      }
    }
    if (ctx.draw) ctx.draw()
  }
}
module.exports = QRCode
