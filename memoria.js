(function(){
  "use strict";

  var BODY = { x:14, y:26, w:72, h:86 };
  var BOUNDS = { left:15.5, right:84.5, top:27.5, bottom:110.5, cr:15 };
  var MARBLE_R = 8.4;
  var GRAVITY = 640;
  var STORAGE_KEY = 'memory-jar-state-v1';

  var storageAvailable = (function(){
    try{
      var t='__mj_test__';
      window.localStorage.setItem(t,'1');
      window.localStorage.removeItem(t);
      return true;
    }catch(e){ return false; }
  })();

  function loadState(){
    if(storageAvailable){
      try{
        var raw = window.localStorage.getItem(STORAGE_KEY);
        if(raw) return JSON.parse(raw);
      }catch(e){}
    }
    return null;
  }
  function saveState(){
    if(!storageAvailable) return;
    try{
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }catch(e){
      showToast("Jar is full \u2014 this device can't save more photos");
    }
  }

  function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function nowISO(){ return new Date().toISOString(); }

  function formatDate(iso){
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric' });
  }
  function formatShort(iso){
    var d = new Date(iso);
    var opts = { month:'short', day:'numeric' };
    return d.toLocaleDateString(undefined, opts);
  }
  function formatRange(startISO, endISO){
    var s = new Date(startISO), e = new Date(endISO);
    var sameDay = s.toDateString() === e.toDateString();
    if(sameDay) return formatShort(startISO);
    var sameYear = s.getFullYear() === e.getFullYear();
    var thisYear = new Date().getFullYear() === e.getFullYear();
    var startStr = formatShort(startISO);
    var endStr = formatShort(endISO);
    if(!thisYear || !sameYear){
      endStr += ', ' + e.getFullYear();
      if(!sameYear) startStr += ', ' + s.getFullYear();
    }
    return startStr + ' \u2013 ' + endStr;
  }

  function toastFallbackNotice(){
    if(!storageAvailable){
      showToast("Photos will stay for this visit only on this browser");
    }
  }

  var toastTimer=null;
  function showToast(msg, ms){
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.classList.remove('show'); }, ms||2200);
  }

  var LID_PALETTE = [
    { name:'Random pastel', value:'random', random:true },
    { name:'Mint', value:'#BFE7D4' },
    { name:'Lavender', value:'#CEC5F0' },
    { name:'Butter', value:'#F3D88B' },
    { name:'Sky', value:'#B9DFF0' },
    { name:'Peach', value:'#F4CDAF' }
  ];
  var state = loadState() || {
    active: newJar(),
    sealed: []
  };

  function newJar(){
    return { id:uid(), startDate: nowISO(), marbles: [], lidColor: randomLidColor(), lidMode:'random' };
  }

  function randomLidColor(){
    var colors = LID_PALETTE.filter(function(color){ return !color.random; });
    return colors[Math.floor(Math.random()*colors.length)].value;
  }

  function lidColorFor(jar){
    if(jar.lidColor) return jar.lidColor;
    var hash = 0;
    for(var i=0;i<jar.id.length;i++) hash = (hash*31 + jar.id.charCodeAt(i)) >>> 0;
    jar.lidColor = LID_PALETTE.filter(function(color){ return !color.random; })[hash % (LID_PALETTE.length - 1)].value;
    return jar.lidColor;
  }

  var pendingLidColor;
  var pendingLidMode;

  function renderLidPalette(selectedColor, selectedMode){
    var options = document.getElementById('lid-color-options');
    options.innerHTML = '';
    LID_PALETTE.forEach(function(color){
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'lid-color-option' + (color.random ? ' random' : '');
      if(!color.random) option.style.setProperty('--swatch-color', color.value);
      option.title = color.name;
      option.setAttribute('aria-label', color.name + ' jar');
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-checked', (color.random ? selectedMode === 'random' : selectedMode !== 'random' && color.value === selectedColor) ? 'true' : 'false');
      option.addEventListener('click', function(){
        if(color.random){
          pendingLidMode = 'random';
          pendingLidColor = randomLidColor();
        } else {
          pendingLidMode = 'fixed';
          pendingLidColor = color.value;
        }
        renderLidPalette(pendingLidColor, pendingLidMode);
      });
      options.appendChild(option);
    });
  }

  function rgbToHsl(r,g,b){
    r/=255; g/=255; b/=255;
    var max=Math.max(r,g,b), min=Math.min(r,g,b);
    var l=(max+min)/2, d=max-min, h=0, s=0;
    if(d!==0){
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      if(max===r) h = ((g-b)/d + (g<b?6:0));
      else if(max===g) h = ((b-r)/d + 2);
      else h = ((r-g)/d + 4);
      h *= 60;
    }
    return [h,s,l];
  }

  function hslToHex(h,s,l){
    var c = (1-Math.abs(2*l-1))*s;
    var hp = (((h % 360) + 360) % 360) / 60;
    var x = c*(1-Math.abs(hp % 2 - 1));
    var rgb;
    if(hp < 1) rgb = [c,x,0];
    else if(hp < 2) rgb = [x,c,0];
    else if(hp < 3) rgb = [0,c,x];
    else if(hp < 4) rgb = [0,x,c];
    else if(hp < 5) rgb = [x,0,c];
    else rgb = [c,0,x];
    var m = l - c/2;
    function part(v){
      var n = Math.max(0, Math.min(255, Math.round((v+m)*255)));
      return ('0' + n.toString(16)).slice(-2);
    }
    return '#' + part(rgb[0]) + part(rgb[1]) + part(rgb[2]);
  }

  function dominantColor(data){
    var buckets = {}, best = null, bestCount = 0;
    var rSum=0, gSum=0, bSum=0, n=0;
    for(var i=0;i<data.length;i+=4){
      var R=data[i], G=data[i+1], B=data[i+2];
      var lum = 0.299*R + 0.587*G + 0.114*B;
      rSum+=R; gSum+=G; bSum+=B; n++;
      if(lum < 28 || lum > 236) continue;
      var key = (R>>4)+'_'+(G>>4)+'_'+(B>>4);
      var bk = buckets[key];
      if(!bk) bk = buckets[key] = { c:0, r:0, g:0, b:0 };
      bk.c++; bk.r+=R; bk.g+=G; bk.b+=B;
    }
    for(var k in buckets){
      if(buckets[k].c > bestCount){ bestCount = buckets[k].c; best = buckets[k]; }
    }
    if(best && bestCount >= n*0.06){
      return [best.r/best.c, best.g/best.c, best.b/best.c];
    }
    if(n===0) return [210,210,215];
    return [rSum/n, gSum/n, bSum/n];
  }

  function pastelFromColor(r,g,b){
    var hsl = rgbToHsl(r,g,b);
    var h = hsl[0], s = hsl[1];
    var ps = (s < 0.06) ? 0.14 : Math.max(0.28, Math.min(0.58, s*0.9 + 0.16));
    return hslToHex(h, ps, 0.80);
  }

  function shade(hex, f){
    var v = hex.replace('#','');
    var r = parseInt(v.substring(0,2),16)*f;
    var g = parseInt(v.substring(2,4),16)*f;
    var b = parseInt(v.substring(4,6),16)*f;
    return '#' + [r,g,b].map(function(c){
      var n = Math.max(0, Math.min(255, Math.round(c)));
      return ('0' + n.toString(16)).slice(-2);
    }).join('');
  }

  function processImage(file){
    return new Promise(function(resolve,reject){
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function(){
        var img = new Image();
        img.onerror = reject;
        img.onload = function(){
          try{
            var maxEdge = 1000;
            var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
            var fw = Math.round(img.width*scale), fh = Math.round(img.height*scale);
            var fc = document.createElement('canvas');
            fc.width=fw; fc.height=fh;
            fc.getContext('2d').drawImage(img,0,0,fw,fh);
            var full = fc.toDataURL('image/jpeg', 0.85);

            var side = Math.min(img.width, img.height);
            var sx = (img.width-side)/2, sy=(img.height-side)/2;
            var msize = 220;
            var mc = document.createElement('canvas');
            mc.width=msize; mc.height=msize;
            var mctx = mc.getContext('2d');
            mctx.drawImage(img, sx, sy, side, side, 0, 0, msize, msize);
            var squareCrop = mc.toDataURL('image/jpeg', 0.82);

            var sc = document.createElement('canvas');
            sc.width=28; sc.height=28;
            var sctx = sc.getContext('2d');
            sctx.drawImage(img, sx, sy, side, side, 0, 0, 28, 28);
            var data = sctx.getImageData(0,0,28,28).data;
            var tone = dominantColor(data);
            var tint = pastelFromColor(tone[0], tone[1], tone[2]);

            resolve({ full:full, squareCrop:squareCrop, tint:tint });
          }catch(err){ reject(err); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function spawnPhysics(m){
    m.r = MARBLE_R;
    m.x = BOUNDS.left + (BOUNDS.right-BOUNDS.left)/2 + (Math.random()*26-13);
    m.y = BOUNDS.top + m.r - 0.5;
    m.vx = (Math.random()*36-18);
    m.vy = 40 + Math.random()*40;
    m.settled = false;
    m.sleepTimer = 0;
  }

  function resolveCornerCircle(m, cx, cy, cr){
    var dx=m.x-cx, dy=m.y-cy;
    var dist=Math.hypot(dx,dy)||0.0001;
    var maxDist=cr-m.r;
    if(dist>maxDist){
      var nx=dx/dist, ny=dy/dist;
      m.x=cx+nx*maxDist; m.y=cy+ny*maxDist;
      var vn=m.vx*nx+m.vy*ny;
      if(vn>0){ m.vx-=vn*nx*1.4; m.vy-=vn*ny*1.4; }
    }
  }

  function resolveContainer(m){
    var b=BOUNDS;
    var inLeftCorner = m.x < b.left+b.cr && m.y > b.bottom-b.cr;
    var inRightCorner = m.x > b.right-b.cr && m.y > b.bottom-b.cr;
    var inLeftTop = m.x < b.left+b.cr && m.y < b.top+b.cr;
    var inRightTop = m.x > b.right-b.cr && m.y < b.top+b.cr;
    if(inLeftCorner) resolveCornerCircle(m, b.left+b.cr, b.bottom-b.cr, b.cr);
    else if(inRightCorner) resolveCornerCircle(m, b.right-b.cr, b.bottom-b.cr, b.cr);
    else if(inLeftTop) resolveCornerCircle(m, b.left+b.cr, b.top+b.cr, b.cr);
    else if(inRightTop) resolveCornerCircle(m, b.right-b.cr, b.top+b.cr, b.cr);
    else if(m.y + m.r > b.bottom){ m.y = b.bottom-m.r; if(m.vy>0) m.vy*=-0.32; m.vx*=0.86; }

    if(m.x - m.r < b.left){ m.x=b.left+m.r; if(m.vx<0) m.vx*=-0.32; }
    if(m.x + m.r > b.right){ m.x=b.right-m.r; if(m.vx>0) m.vx*=-0.32; }
    if(m.y - m.r < b.top){ m.y=b.top+m.r; if(m.vy<0) m.vy*=-0.2; }
  }

  function resolveCollisions(list){
    for(var pass=0; pass<2; pass++){
      for(var i=0;i<list.length;i++){
        for(var j=i+1;j<list.length;j++){
          var a=list[i], bb=list[j];
          var dx=bb.x-a.x, dy=bb.y-a.y;
          var dist=Math.hypot(dx,dy)||0.0001;
          var minDist=a.r+bb.r;
          if(dist<minDist){
            var overlap=(minDist-dist)/2;
            var nx=dx/dist, ny=dy/dist;
            if(!a.settled){ a.x-=nx*overlap; a.y-=ny*overlap; }
            if(!bb.settled){ bb.x+=nx*overlap; bb.y+=ny*overlap; }
            var avx=(a.vx+bb.vx)/2, avy=(a.vy+bb.vy)/2;
            if(!a.settled){ a.vx=avx*0.85; a.vy=avy*0.85; }
            if(!bb.settled){ bb.vx=avx*0.85; bb.vy=avy*0.85; }
            if(a.settled && !bb.settled){ bb.settled=false; }
            if(bb.settled && !a.settled){ a.settled=false; }
          }
        }
      }
    }
  }

  function stepPhysics(list, dt){
    var anyAwake=false;
    list.forEach(function(m){
      if(m.settled) return;
      anyAwake=true;
      m.vy += GRAVITY*dt;
      m.vx *= 0.992;
      m.x += m.vx*dt;
      m.y += m.vy*dt;
      resolveContainer(m);
    });
    resolveCollisions(list);
    list.forEach(function(m){
      if(m.settled) return;
      var speed = Math.hypot(m.vx,m.vy);
      if(speed < 6){
        m.sleepTimer += dt;
        if(m.sleepTimer > 0.22){ m.settled=true; m.vx=0; m.vy=0; }
      } else {
        m.sleepTimer = 0;
      }
    });
    return anyAwake;
  }

  function buildJarElement(jarData){
    var jar = document.createElement('div');
    jar.className = 'jar';
    setJarLidColor(jar, lidColorFor(jarData || state.active));
    jar.innerHTML =
      '<div class="jar-contact-shadow" aria-hidden="true"></div>' +
      '<div class="jar-body-shell" aria-hidden="true"></div>' +
      '<div class="jar-marbles"></div>' +
      '<div class="jar-neck" aria-hidden="true"></div>' +
      '<div class="jar-lid" aria-hidden="true"></div>';
    return jar;
  }

  function setJarLidColor(jar, color){
    jar.style.setProperty('--lid-color', color);
  }

  function marbleStyle(el, m){
    el.style.left = ((m.x - BODY.x)/BODY.w*100) + '%';
    el.style.top = ((m.y - BODY.y)/BODY.h*100) + '%';
    el.style.width = (m.r*2/BODY.w*100) + '%';
    el.style.height = (m.r*2/BODY.h*100) + '%';
  }

  function marbleVisual(m){
    return {
      backgroundImage:
        'radial-gradient(circle at 50% 50%, rgba(255,255,255,0) 58%, rgba(255,255,255,0.42) 84%, rgba(255,255,255,0.08) 100%),' +
        'radial-gradient(circle at 33% 26%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.42) 12%, rgba(255,255,255,0) 30%),' +
        'radial-gradient(circle at 70% 76%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 46%),' +
        'radial-gradient(circle at 74% 70%, rgba(38,30,50,0.45) 0%, rgba(38,30,50,0) 62%),' +
        'radial-gradient(circle at 42% 36%, ' + hexToRgba(m.tint,0.6) + ' 0%, ' + hexToRgba(shade(m.tint,0.8),0.6) + ' 100%),' +
        'url(' + m.squareCrop + ')',
      backgroundBlendMode: 'screen,screen,screen,multiply,soft-light,normal'
    };
  }

  function applyMarbleVisual(el, m, shadowY){
    var vis = marbleVisual(m);
    var sy = shadowY || 3;
    el.style.backgroundImage = vis.backgroundImage;
    el.style.backgroundBlendMode = vis.backgroundBlendMode;
    el.style.boxShadow =
      'inset 0 0 0 1.2px ' + hexToRgba(shade(m.tint,0.62),0.3) + ', ' +
      '0 ' + sy + 'px ' + (sy*2.3).toFixed(1) + 'px ' + hexToRgba(shade(m.tint,0.45),0.28);
    return el;
  }

  function buildMarbleEl(m){
    var el = document.createElement('div');
    el.className = 'marble';
    applyMarbleVisual(el, m);
    marbleStyle(el, m);
    el.dataset.id = m.id;
    return el;
  }

  function hexToRgba(hex, a){
    var v = hex.replace('#','');
    var r = parseInt(v.substring(0,2),16), g=parseInt(v.substring(2,4),16), b=parseInt(v.substring(4,6),16);
    return 'rgba('+r+','+g+','+b+','+a+')';
  }

  var homeJarEl = null;
  var homeMarbleEls = {};
  var physicsRunning = false;

  function renderHomeJar(opts){
    var stage = document.getElementById('home-jar-stage');
    var old = stage.querySelector('.jar');
    if(old) old.remove();
    homeJarEl = buildJarElement(state.active);
    if(opts && opts.animateIn) homeJarEl.classList.add('entering');
    stage.appendChild(homeJarEl);
    homeMarbleEls = {};
    var marblesLayer = homeJarEl.querySelector('.jar-marbles');
    state.active.marbles.forEach(function(m){
      var el = buildMarbleEl(m);
      el.addEventListener('click', function(){ openInspectFromEl(m, el); });
      marblesLayer.appendChild(el);
      homeMarbleEls[m.id] = el;
    });
    updateCloseButtonVisibility();
    ensurePhysicsLoop();
  }

  function updateCloseButtonVisibility(){
    var btn = document.getElementById('btn-close-jar');
    btn.style.visibility = state.active.marbles.length > 0 ? 'visible' : 'hidden';
  }

  var lastTick = null;
  function physicsLoop(ts){
    if(lastTick===null) lastTick = ts;
    var dt = Math.min((ts-lastTick)/1000, 0.032);
    lastTick = ts;
    var awake = stepPhysics(state.active.marbles, dt);
    state.active.marbles.forEach(function(m){
      var el = homeMarbleEls[m.id];
      if(el) marbleStyle(el, m);
    });
    if(awake){
      requestAnimationFrame(physicsLoop);
    } else {
      physicsRunning = false;
      lastTick = null;
      saveState();
    }
  }
  function ensurePhysicsLoop(){
    var anyAwake = state.active.marbles.some(function(m){ return !m.settled; });
    if(anyAwake && !physicsRunning){
      physicsRunning = true;
      lastTick = null;
      requestAnimationFrame(physicsLoop);
    }
  }

  function addMarbleToActiveJar(data){
    var m = {
      id: uid(),
      full: data.full,
      squareCrop: data.squareCrop,
      tint: data.tint,
      date: nowISO()
    };
    spawnPhysics(m);
    state.active.marbles.push(m);
    var el = buildMarbleEl(m);
    el.addEventListener('click', function(){ openInspectFromEl(m, el); });
    homeJarEl.querySelector('.jar-marbles').appendChild(el);
    homeMarbleEls[m.id] = el;
    updateCloseButtonVisibility();
    ensurePhysicsLoop();
    saveState();
  }

  function renderStaticJar(container, jarData, onMarbleClick){
    var jar = buildJarElement(jarData);
    jar.classList.add('sealing');
    container.appendChild(jar);
    var layer = jar.querySelector('.jar-marbles');
    jarData.marbles.forEach(function(m){
      var el = buildMarbleEl(m);
      marbleStyle(el, m);
      if(onMarbleClick){
        el.addEventListener('click', function(){ onMarbleClick(m, el); });
      } else {
        el.style.cursor = 'default';
      }
      layer.appendChild(el);
    });
    return jar;
  }

  function openSealModal(){
    if(state.active.marbles.length===0) return;
    var input = document.getElementById('seal-title-input');
    var placeholder = formatRange(state.active.startDate, nowISO());
    input.value = '';
    input.placeholder = placeholder;
    pendingLidMode = state.active.lidMode || 'random';
    pendingLidColor = pendingLidMode === 'random' ? randomLidColor() : lidColorFor(state.active);
    renderLidPalette(pendingLidColor, pendingLidMode);
    document.getElementById('seal-modal').classList.remove('hidden');
    setTimeout(function(){ input.focus(); }, 50);
  }
  function closeSealModal(){
    document.getElementById('seal-modal').classList.add('hidden');
  }

  function confirmSeal(){
    var input = document.getElementById('seal-title-input');
    var title = input.value.trim() || input.placeholder;
    var endISO = nowISO();
    closeSealModal();
    state.active.lidMode = pendingLidMode || 'random';
    state.active.lidColor = pendingLidColor || randomLidColor();
    setJarLidColor(homeJarEl, state.active.lidColor);

    homeJarEl.classList.add('sealing');
    setTimeout(function(){
      homeJarEl.classList.add('slide-off');
      setTimeout(function(){
        var sealed = {
          id: state.active.id,
          lidColor: state.active.lidColor,
          lidMode: state.active.lidMode,
          title: title,
          dateRange: formatRange(state.active.startDate, endISO),
          startDate: state.active.startDate,
          endDate: endISO,
          marbles: state.active.marbles.map(function(m){ return Object.assign({}, m); })
        };
        state.sealed.unshift(sealed);
        state.active = newJar();
        saveState();
        renderHomeJar({animateIn:true});
        renderShelves();
        showToast('Jar sealed \u2014 find it on the Shelves');
      }, 560);
    }, 640);
  }

  function renderShelves(){
    var container = document.getElementById('shelves-container');
    container.innerHTML = '';
    if(state.sealed.length===0){
      container.innerHTML = '<div class="empty-shelf"><p>Nothing on the shelf yet. Seal a jar from the home screen to see it here.</p></div>';
      updateDrawButton();
      return;
    }
    var perRow = 3;
    for(var i=0;i<state.sealed.length;i+=perRow){
      var row = document.createElement('div');
      row.className = 'shelf-row';
      state.sealed.slice(i,i+perRow).forEach(function(jarData){
        row.appendChild(buildShelfJarButton(jarData));
      });
      container.appendChild(row);
    }
    updateDrawButton();
  }

  function buildShelfJarButton(jarData){
    var btn = document.createElement('button');
    btn.className = 'shelf-jar';
    var stage = document.createElement('div');
    stage.className = 'mini-stage';
    renderStaticJar(stage, { id:jarData.id, lidColor:jarData.lidColor, lidMode:jarData.lidMode, marbles:jarData.marbles.slice(0,10) }, null);
    var label = document.createElement('div');
    label.className = 'shelf-jar-label';
    label.textContent = jarData.title;
    btn.appendChild(stage);
    btn.appendChild(label);
    btn.addEventListener('click', function(){ openJarViewer(jarData); });
    return btn;
  }

  function updateDrawButton(){
    var btn = document.getElementById('btn-draw');
    var total = state.sealed.reduce(function(n,j){ return n+j.marbles.length; }, 0);
    btn.disabled = total===0;
    btn.textContent = total===0 ? 'Nothing sealed yet' : 'Draw a memory';
  }

  function openJarViewer(jarData){
    var overlay = document.getElementById('jar-viewer');
    var viewerTint = lidColorFor(jarData);
    overlay.style.setProperty('--viewer-tint', viewerTint);
    overlay.style.setProperty('--viewer-tint-soft', hexToRgba(viewerTint, .62));
    document.getElementById('viewer-title').textContent = jarData.title;
    var inner = document.getElementById('viewer-jar-inner');
    var old = inner.querySelector('.jar');
    if(old) old.remove();
    renderStaticJar(inner, jarData, function(m, el){ openInspectFromEl(m, el); });
    overlay.classList.remove('hidden');
  }
  function closeJarViewer(){
    document.getElementById('jar-viewer').classList.add('hidden');
  }

  var currentInspect = null;

  function cardTargetRect(){
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(vw*0.8, 360);
    var h = w*1.28;
    if(h > vh*0.72){ h = vh*0.72; w = h/1.28; }
    return {
      left: (vw-w)/2,
      top: (vh-h)/2 - 10,
      width: w,
      height: h
    };
  }

  function openInspectFromEl(m, el){
    var rect = el.getBoundingClientRect();
    openInspect(m, rect, el);
  }

  function openInspect(m, sourceRect, sourceEl, fromLabel){
    if(currentInspect) return;
    var overlay = document.getElementById('inspect-overlay');
    overlay.classList.remove('hidden');
    requestAnimationFrame(function(){ overlay.classList.add('active'); });

    var clone = document.createElement('div');
    clone.className = 'inspect-clone';
    clone.style.backgroundImage = 'url(' + m.full + ')';
    clone.style.left = sourceRect.left+'px';
    clone.style.top = sourceRect.top+'px';
    clone.style.width = sourceRect.width+'px';
    clone.style.height = sourceRect.height+'px';
    clone.style.borderRadius = '50%';
    document.body.appendChild(clone);
    if(sourceEl) sourceEl.style.opacity = '0';

    var caption = document.createElement('div');
    caption.className = 'inspect-caption';
    caption.innerHTML = '<div class="inspect-date">'+formatDate(m.date)+'</div>' +
      (fromLabel ? '<div class="inspect-from">from '+fromLabel+'</div>' : '');
    document.body.appendChild(caption);

    currentInspect = { marble:m, sourceEl:sourceEl, sourceRect:sourceRect, clone:clone, caption:caption };

    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        var target = cardTargetRect();
        clone.style.left = target.left+'px';
        clone.style.top = target.top+'px';
        clone.style.width = target.width+'px';
        clone.style.height = target.height+'px';
        clone.style.borderRadius = '20px';
        caption.style.left = (target.left+target.width/2)+'px';
        caption.style.top = (target.top+target.height+16)+'px';
        setTimeout(function(){ caption.classList.add('show'); }, 260);
      });
    });

    overlay.onclick = function(e){ if(e.target===overlay) closeInspect(); };
  }

  function closeInspect(){
    if(!currentInspect) return;
    var ci = currentInspect;
    ci.caption.classList.remove('show');
    var rect = ci.sourceEl ? ci.sourceEl.getBoundingClientRect() : ci.sourceRect;
    ci.clone.style.left = rect.left+'px';
    ci.clone.style.top = rect.top+'px';
    ci.clone.style.width = rect.width+'px';
    ci.clone.style.height = rect.height+'px';
    ci.clone.style.borderRadius = '50%';
    document.getElementById('inspect-overlay').classList.remove('active');

    setTimeout(function(){
      ci.clone.remove();
      ci.caption.remove();
      if(ci.sourceEl) ci.sourceEl.style.opacity = '1';
      document.getElementById('inspect-overlay').classList.add('hidden');
      currentInspect = null;
    }, 440);
  }

  var drawInFlight = false;

  function drawRandomMemory(){
    if(drawInFlight || currentInspect) return;
    var pool = [];
    state.sealed.forEach(function(j){
      j.marbles.forEach(function(m){ pool.push({ marble:m, jarTitle:j.title }); });
    });
    if(pool.length===0) return;
    var pick = pool[Math.floor(Math.random()*pool.length)];
    var m = pick.marble;

    var vw = window.innerWidth, vh = window.innerHeight;
    var br = document.getElementById('btn-draw').getBoundingClientRect();

    drawInFlight = true;
    var floater = document.createElement('div');
    floater.className = 'float-marble';
    applyMarbleVisual(floater, m, 14);

    function place(cx, cy, size){
      floater.style.left = (cx - size/2) + 'px';
      floater.style.top = (cy - size/2) + 'px';
      floater.style.width = size + 'px';
      floater.style.height = size + 'px';
    }

    place(br.left + br.width/2, br.top + br.height/2, 24);
    document.body.appendChild(floater);

    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        floater.style.opacity = '1';
        place(vw/2, vh/2 - 70, 66);
      });
    });

    setTimeout(function(){
      place(vw/2, vh/2 - 10, 58);
      setTimeout(function(){
        openInspect(m, floater.getBoundingClientRect(), null, pick.jarTitle);
        floater.remove();
        drawInFlight = false;
      }, 200);
    }, 520);
  }

  var onShelves = false;
  function goTo(view){
    onShelves = (view==='shelves');
    document.getElementById('track').classList.toggle('on-shelves', onShelves);
  }

  (function setupSwipe(){
    var startX=null, startY=null, dragging=false;
    var app = document.getElementById('app');
    app.addEventListener('touchstart', function(e){
      if(e.touches.length!==1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = true;
    }, {passive:true});
    app.addEventListener('touchend', function(e){
      if(!dragging) return;
      dragging = false;
      var endX = e.changedTouches[0].clientX;
      var endY = e.changedTouches[0].clientY;
      var dx = endX-startX, dy = endY-startY;
      if(Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)*1.4){
        if(dx < 0 && !onShelves) goTo('shelves');
        else if(dx > 0 && onShelves) goTo('home');
      }
    }, {passive:true});
  })();

  document.getElementById('btn-shelves').addEventListener('click', function(){ goTo('shelves'); });
  document.getElementById('btn-home').addEventListener('click', function(){ goTo('home'); });

  document.getElementById('btn-add').addEventListener('click', function(){
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', function(e){
    var files = Array.prototype.slice.call(e.target.files||[]);
    e.target.value = '';
    if(files.length===0) return;
    files.reduce(function(chain, file, idx){
      return chain.then(function(){
        return processImage(file).then(function(data){
          addMarbleToActiveJar(data);
          if(idx===0) toastFallbackNotice();
          return new Promise(function(r){ setTimeout(r, 90); });
        }).catch(function(){ showToast("Couldn't read that photo"); });
      });
    }, Promise.resolve());
  });

  document.getElementById('btn-close-jar').addEventListener('click', openSealModal);
  document.getElementById('seal-cancel').addEventListener('click', closeSealModal);
  document.getElementById('seal-confirm').addEventListener('click', confirmSeal);
  document.getElementById('seal-title-input').addEventListener('keydown', function(e){
    if(e.key==='Enter') confirmSeal();
  });
  document.getElementById('seal-modal').addEventListener('click', function(e){
    if(e.target.id==='seal-modal') closeSealModal();
  });

  document.getElementById('viewer-close').addEventListener('click', closeJarViewer);
  document.getElementById('jar-viewer').addEventListener('click', function(e){
    if(e.target.id==='jar-viewer') closeJarViewer();
  });

  document.getElementById('btn-draw').addEventListener('click', drawRandomMemory);

  document.addEventListener('keydown', function(e){
    if(e.key==='Escape'){
      if(currentInspect) closeInspect();
      else if(!document.getElementById('seal-modal').classList.contains('hidden')) closeSealModal();
      else if(!document.getElementById('jar-viewer').classList.contains('hidden')) closeJarViewer();
    }
  });

  renderHomeJar({animateIn:false});
  renderShelves();
})();
