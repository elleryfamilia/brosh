// brosh landing page scripts

(function () {
  'use strict';

  var REPO = 'elleryfamilia/brosh';
  var RELEASE_API = 'https://api.github.com/repos/' + REPO + '/releases/latest';

  // ---- Copy buttons ----
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = this.getAttribute('data-copy');
      navigator.clipboard.writeText(text).then(function () {
        btn.classList.add('copied');
        setTimeout(function () { btn.classList.remove('copied'); }, 2000);
      });
    });
  });

  // ---- Nav scroll effect ----
  var nav = document.getElementById('nav');
  function updateNav() {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }
  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  // ---- Mobile hamburger ----
  var toggle = document.getElementById('nav-toggle');
  var links = document.getElementById('nav-links');
  toggle.addEventListener('click', function () {
    toggle.classList.toggle('open');
    links.classList.toggle('open');
  });
  links.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      toggle.classList.remove('open');
      links.classList.remove('open');
    });
  });

  // ---- Showcase tabs ----
  var tabs = document.querySelectorAll('.showcase-tab');
  var panels = document.querySelectorAll('.showcase-panel');

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var target = this.getAttribute('data-tab');
      tabs.forEach(function (t) { t.classList.remove('active'); });
      panels.forEach(function (p) { p.classList.remove('active'); });
      this.classList.add('active');
      var panel = document.querySelector('[data-panel="' + target + '"]');
      if (panel) {
        panel.classList.add('active');
        tryLoadVideo(panel);
      }
    });
  });

  function tryLoadVideo(panel) {
    var video = panel.querySelector('.showcase-video');
    if (!video || video.classList.contains('loaded') || video.classList.contains('failed')) return;
    var src = video.getAttribute('data-src');
    if (!src) return;

    fetch(src, { method: 'HEAD' }).then(function (res) {
      if (res.ok) {
        video.src = src;
        video.addEventListener('loadeddata', function () {
          video.classList.add('loaded');
          video.play().catch(function () {});
        }, { once: true });
        video.load();
      } else {
        video.classList.add('failed');
      }
    }).catch(function () {
      video.classList.add('failed');
    });
  }

  var activePanel = document.querySelector('.showcase-panel.active');
  if (activePanel) tryLoadVideo(activePanel);

  // ---- Scroll reveal ----
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReduced) {
    var reveals = document.querySelectorAll('.reveal');
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    reveals.forEach(function (el) { observer.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) {
      el.classList.add('visible');
    });
  }

  // ---- OS Detection ----
  function detectOS() {
    var ua = navigator.userAgent;
    var platform = navigator.platform || '';

    if (navigator.userAgentData) {
      var p = navigator.userAgentData.platform || '';
      if (p === 'macOS') return { os: 'macos', arch: guessArch() };
      if (p === 'Linux') return { os: 'linux', arch: 'x64' };
      if (p === 'Windows') return { os: 'windows', arch: 'x64' };
    }

    if (/Mac/i.test(platform) || /Mac/i.test(ua)) return { os: 'macos', arch: guessArch() };
    if (/Linux/i.test(platform) || /Linux/i.test(ua)) return { os: 'linux', arch: 'x64' };
    if (/Win/i.test(platform) || /Win/i.test(ua)) return { os: 'windows', arch: 'x64' };

    return { os: 'unknown', arch: 'x64' };
  }

  function guessArch() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          var renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
          if (/Apple M/i.test(renderer) || /Apple GPU/i.test(renderer)) {
            return 'arm64';
          }
        }
      }
    } catch (e) {}
    return 'arm64'; // Default to arm64 for modern Macs
  }

  // ---- Helper: create element with attributes ----
  function createEl(tag, attrs, textContent) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'className') {
          el.className = attrs[key];
        } else {
          el.setAttribute(key, attrs[key]);
        }
      });
    }
    if (textContent) el.textContent = textContent;
    return el;
  }

  // ---- Release info + downloads ----
  function fetchRelease() {
    var cached = sessionStorage.getItem('brosh_release');
    if (cached) {
      try {
        renderDownloads(JSON.parse(cached));
        return;
      } catch (e) {}
    }

    fetch(RELEASE_API)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.tag_name) {
          var release = {
            version: data.tag_name.replace(/^v/, ''),
            tag: data.tag_name,
            assets: (data.assets || []).map(function (a) {
              return { name: a.name, url: a.browser_download_url };
            })
          };
          sessionStorage.setItem('brosh_release', JSON.stringify(release));
          renderDownloads(release);
        }
      })
      .catch(function () {
        renderDownloads(null);
      });
  }

  function renderDownloads(release) {
    var detected = detectOS();
    var versionEl = document.getElementById('download-version');
    var primaryEl = document.getElementById('download-primary');
    var directEl = document.getElementById('direct-links');
    var heroBtn = document.getElementById('hero-download-btn');
    var navBtn = document.getElementById('nav-download-btn');
    var heroInstall = document.getElementById('hero-install');

    if (release && versionEl) {
      versionEl.textContent = 'Latest: v' + release.version;
    }

    function findAsset(pattern) {
      if (!release) return null;
      for (var i = 0; i < release.assets.length; i++) {
        if (pattern.test(release.assets[i].name)) {
          return release.assets[i].url;
        }
      }
      return null;
    }

    var macArm = findAsset(/arm64.*\.dmg$/);
    var macIntel = findAsset(/x64.*\.dmg$/) || findAsset(/amd64.*\.dmg$/);
    var linuxAmd = findAsset(/amd64.*\.deb$/);
    var linuxArm = findAsset(/arm64.*\.deb$/);

    // Clear existing content
    while (primaryEl.firstChild) primaryEl.removeChild(primaryEl.firstChild);

    function setDownloadLink(btn, url, text) {
      if (!btn) return;
      btn.href = url;
      if (text) btn.textContent = text;
    }

    if (detected.os === 'macos') {
      var dmgUrl = detected.arch === 'arm64' ? (macArm || macIntel) : (macIntel || macArm);
      var chipLabel = detected.arch === 'arm64' ? 'Apple Silicon' : 'Intel';
      var label = 'Download for Mac' + (dmgUrl ? ' (' + chipLabel + ')' : '');
      var url = dmgUrl || 'https://github.com/' + REPO + '/releases/latest';
      primaryEl.appendChild(createEl('a', {
        href: url,
        className: 'btn btn-primary'
      }, label));
      setDownloadLink(heroBtn, url, 'Download for Mac');
      setDownloadLink(navBtn, url, 'Download for Mac');
    } else if (detected.os === 'linux') {
      primaryEl.appendChild(createEl('div', {
        className: 'download-command'
      }, 'curl -fsSL https://bro.sh/install.sh | sudo bash'));
      setDownloadLink(heroBtn, '#download', 'Install on Linux');
      setDownloadLink(navBtn, '#download', 'Install on Linux');
      if (heroInstall) heroInstall.style.display = 'none';
    } else {
      var fallbackUrl = 'https://github.com/' + REPO + '/releases/latest';
      primaryEl.appendChild(createEl('a', {
        href: fallbackUrl,
        className: 'btn btn-primary'
      }, 'Download'));
      setDownloadLink(heroBtn, fallbackUrl);
      setDownloadLink(navBtn, fallbackUrl);
      if (heroInstall) heroInstall.style.display = 'none';
    }

    // Direct download links
    if (directEl && release) {
      while (directEl.firstChild) directEl.removeChild(directEl.firstChild);
      var allLinks = [
        { label: 'macOS (Apple Silicon) .dmg', url: macArm },
        { label: 'macOS (Intel) .dmg', url: macIntel },
        { label: 'Linux amd64 .deb', url: linuxAmd },
        { label: 'Linux arm64 .deb', url: linuxArm }
      ];
      allLinks.forEach(function (link) {
        if (link.url) {
          directEl.appendChild(createEl('a', { href: link.url }, link.label));
        }
      });
    }
  }

  fetchRelease();

  // Async high-entropy arch detection (Chromium)
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    navigator.userAgentData.getHighEntropyValues(['architecture']).then(function (data) {
      if (data.architecture === 'arm') {
        var cached = sessionStorage.getItem('brosh_release');
        if (cached) {
          try { renderDownloads(JSON.parse(cached)); } catch (e) {}
        }
      }
    }).catch(function () {});
  }
})();
