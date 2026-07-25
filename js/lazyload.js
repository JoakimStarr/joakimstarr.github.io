/* global KEEP */

KEEP.initLazyLoad = () => {
  if (KEEP?.theme_config?.lazyload?.enable !== true) {
    return
  }

  const imgs = document.querySelectorAll('img')
  let now = Date.now()
  let needLoad = true

  function lazyload(imgs) {
    now = Date.now()
    needLoad = Array.from(imgs).some((i) => i.hasAttribute('lazyload'))
    const viewOffsetTop =
      window.innerHeight + document.documentElement.scrollTop || document.body.scrollTop

    imgs.forEach((img) => {
      // Handle post content images (lazyload attr + data-src)
      if (img.hasAttribute('lazyload') && !img.hasAttribute('loading')) {
        const imgOffsetTop = window.scrollY + img.getBoundingClientRect().top

        if (viewOffsetTop > imgOffsetTop) {
          img.setAttribute('loading', true)
          const loadImageTimeout = setTimeout(() => {
            const tempImg = new Image()
            const src = img.getAttribute('data-src')
            tempImg.src = src
            tempImg.onload = () => {
              img.src = src
              img.removeAttribute('lazyload')
              img.removeAttribute('loading')
              clearTimeout(loadImageTimeout)
            }
          }, 500)
        }
      }

      // Handle data-original images (avatar/logo/theme elements)
      if (img.hasAttribute('data-original') && !img.hasAttribute('loading')) {
        const realSrc = img.getAttribute('data-original')
        const tempImg = new Image()
        tempImg.src = realSrc
        tempImg.onload = () => {
          img.src = realSrc
          img.removeAttribute('data-original')
        }
      }
    })
  }

  lazyload(imgs)

  window.onscroll = () => {
    if (Date.now() - now > 50 && needLoad) {
      if (imgs.length) {
        lazyload(imgs)
      }
    }
  }
}
