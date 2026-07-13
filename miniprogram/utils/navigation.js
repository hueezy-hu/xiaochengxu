function switchTab(url) {
  return wx.switchTab({ url })
}

function safeBack(fallback = '/pages/home/home') {
  const pages = getCurrentPages()
  if (pages.length > 1) return wx.navigateBack()
  return switchTab(fallback)
}

module.exports = { safeBack, switchTab }
