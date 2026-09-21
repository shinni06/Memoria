/* Headless tests for the Memory Jar physics core.
   Run: node test/physics.test.js */
"use strict";

var P = require("../js/physics.js");
var assert = require("assert");

var B = P.BOUNDS;
var STEP = P.SUBSTEP;
var FRAME = 1/60; // simulate 60Hz frames

function mkMarble(x, y){
  var m = { id:"m"+Math.random().toString(36).slice(2,7) };
  P.spawnPhysics(m);
  m.x = x; m.y = y; m.vx = 0; m.vy = 0;
  m.settled = false; m.slowTime = 0;
  return m;
}

/* Run `seconds` of simulated time at 60fps frames. */
function simulate(list, seconds, held){
  for(var f=0; f<seconds*60; f++){
    var acc = 0;
    for(var s=0; s<12; s++){
      P.stepPhysics(list, STEP, held||null);
      acc += STEP;
      if(acc >= FRAME) break;
    }
    P.updateSleep(list, FRAME, held||null);
  }
}

function allSettled(list){
  return list.every(function(m){ return m.settled; });
}

function insideBounds(m){
  var pad = 0.6;
  return m.x - m.r >= B.left - pad && m.x + m.r <= B.right + pad &&
         m.y - m.r >= B.top - pad && m.y + m.r <= B.bottom + pad;
}

var passed = 0;
function test(name, fn){
  try{
    fn();
    passed++;
    console.log("  ok - " + name);
  }catch(e){
    console.error("  FAIL - " + name);
    console.error("    " + (e && e.message));
    process.exitCode = 1;
  }
}

console.log("Physics core tests");

/* 1. Gravity: a marble released above the floor falls down into the jar. */
test("gravity pulls a free marble down into the jar", function(){
  var m = mkMarble(50, 40);
  var list = [m];
  simulate(list, 0.5);
  assert.ok(m.y > 60, "expected y to grow substantially, got " + m.y.toFixed(1));
  assert.ok(insideBounds(m), "marble escaped bounds");
});

/* 2. Settling: a pile comes to complete rest. */
test("a pile of marbles settles completely", function(){
  var list = [];
  for(var i=0;i<10;i++){
    list.push(mkMarble(50 + (Math.random()*30-15), 40 + i*2));
  }
  simulate(list, 6);
  assert.ok(allSettled(list), "not all marbles settled after 6s");
  list.forEach(function(m){ assert.ok(insideBounds(m)); });
});

/* 3. THE jitter test: once settled, positions must be frozen. */
test("settled pile does not shake (positions frozen)", function(){
  var list = [];
  for(var i=0;i<9;i++){
    list.push(mkMarble(50 + (Math.random()*26-13), 45 + i*1.5));
  }
  simulate(list, 6);
  assert.ok(allSettled(list));
  var before = list.map(function(m){ return { x:m.x, y:m.y }; });
  simulate(list, 3); // 3 more seconds of running
  list.forEach(function(m, i){
    assert.strictEqual(m.x, before[i].x, "x moved while settled");
    assert.strictEqual(m.y, before[i].y, "y moved while settled");
    assert.strictEqual(m.vx, 0);
    assert.strictEqual(m.vy, 0);
  });
});

/* 4. Drag reaction: yanking a bottom marble must wake & move the marble
      resting on it. Fixed positions (not random) so the test is deterministic. */
test("dragging a marble reacts the pile around it", function(){
  var list = [
    mkMarble(50, B.bottom - 6.5),      // target on the floor
    mkMarble(50, B.bottom - 6.5 - 13), // resting directly on the target
    mkMarble(63.2, B.bottom - 6.5)     // side neighbour on the floor
  ];
  list.forEach(function(m){ m.settled = true; });

  var target = list[0];
  var neighbours = list.slice(1).map(function(m){ return { x:m.x, y:m.y }; });

  target.settled = false;
  target.slowTime = 0;
  target._tx = target.x; target._ty = target.y;
  var held = target;
  // drag target upward for 1.2s
  for(var f=0; f<72; f++){
    target._ty = B.bottom - target.r - 1 - (f/72)*18; // lift it
    target._tx = target.x;
    var acc=0;
    for(var s=0;s<12;s++){
      P.stepPhysics(list, STEP, held);
      acc += STEP;
      if(acc >= FRAME) break;
    }
    P.updateSleep(list, FRAME, held);
  }

  var moved = 0;
  list.slice(1).forEach(function(m, i){
    var d = Math.hypot(m.x-neighbours[i].x, m.y-neighbours[i].y);
    if(d > 0.5) moved++;
  });
  assert.ok(moved >= 1, "expected at least 1 neighbour to react, got " + moved);

  // release: everything settles again
  simulate(list, 5);
  assert.ok(allSettled(list), "pile did not re-settle after release");
  list.forEach(function(m){ assert.ok(insideBounds(m)); });
});

/* 5. Violent dragging never escapes the jar. */
test("marbles stay contained during violent dragging", function(){
  var list = [];
  for(var i=0;i<6;i++){
    list.push(mkMarble(50, 50 + i*3));
  }
  simulate(list, 3);
  var held = list[0];
  held.settled = false; held.slowTime = 0;
  for(var f=0; f<180; f++){
    // whip the target around the whole jar interior
    var t = f/180 * Math.PI * 4;
    held._tx = 50 + Math.cos(t)*16;
    held._ty = 65 + Math.sin(t)*16;
    var acc=0;
    for(var s=0;s<12;s++){
      P.stepPhysics(list, STEP, held);
      acc += STEP;
      if(acc >= FRAME) break;
    }
    P.updateSleep(list, FRAME, held);
  }
  list.forEach(function(m){
    assert.ok(insideBounds(m), "marble out of bounds at " + m.x.toFixed(1) + "," + m.y.toFixed(1));
    assert.ok(isFinite(m.x) && isFinite(m.y), "NaN position!");
  });
});

/* 6. Impact wake: hitting a settled pile wakes exactly the affected cluster. */
test("strong impact wakes sleeping neighbours, then re-settles", function(){
  var list = [];
  for(var i=0;i<6;i++){
    list.push(mkMarble(50 + (Math.random()*20-10), 55 + i*2));
  }
  simulate(list, 6);
  assert.ok(allSettled(list));
  var falling = mkMarble(50, 34);
  falling.vy = 250;
  list.push(falling);
  simulate(list, 0.2);
  var awakeCount = list.filter(function(m){ return !m.settled; }).length;
  assert.ok(awakeCount > 1, "expected pile to react to impact, awake=" + awakeCount);
  simulate(list, 6);
  assert.ok(allSettled(list), "pile did not settle again");
  list.forEach(function(m){ assert.ok(insideBounds(m)); });
});

/* 7. Frame-rate independence: 30fps and 120fps converge to the same result. */
test("simulation is frame-rate independent", function(){
  function run(framesPerSecond){
    var list = [mkMarble(50, 40)];
    var dt = 1/framesPerSecond;
    var steps = Math.round(1.5 * framesPerSecond);
    for(var f=0; f<steps; f++){
      var acc = 0;
      while(acc < dt){
        P.stepPhysics(list, STEP, null);
        acc += STEP;
      }
      P.updateSleep(list, dt, null);
    }
    return list[0];
  }
  var a = run(30), b = run(120);
  assert.ok(Math.abs(a.y - b.y) < 0.75, "y diverged: " + a.y.toFixed(2) + " vs " + b.y.toFixed(2));
  assert.ok(Math.abs(a.x - b.x) < 0.75, "x diverged: " + a.x.toFixed(2) + " vs " + b.x.toFixed(2));
});

/* 8. Solidity: marbles must never visibly override each other, even
      during violent flings and hard drags through a settled pile.       */
test("marbles never interpenetrate beyond visual tolerance", function(){
  function maxPenetration(list){
    var worst = 0;
    for(var i=0;i<list.length;i++){
      for(var j=i+1;j<list.length;j++){
        var a=list[i], b=list[j];
        var d = Math.hypot(b.x-a.x, b.y-a.y);
        var pen = (a.r+b.r) - d;
        if(pen > worst) worst = pen;
      }
    }
    return worst;
  }

  // Scenario A: violent flings through a pile
  var list = [];
  for(var i=0;i<10;i++) list.push(mkMarble(50 + (Math.random()*20-10), 50 + i*2));
  simulate(list, 4);
  var worst = 0;
  for(var f=0; f<240; f++){
    var cannon = mkMarble(50, 32);
    cannon.vy = 500;
    cannon.vx = Math.sin(f)*80;
    list.push(cannon);
    // one frame only — sample right after integration/correction
    for(var s=0; s<12; s++){
      P.stepPhysics(list, STEP, null);
      if(s===11) worst = Math.max(worst, maxPenetration(list));
      if(s>=11) break;
    }
    P.updateSleep(list, FRAME, null);
    list.splice(list.indexOf(cannon), 1);
  }
  assert.ok(worst <= P.SLOP + 0.35,
    "fling penetration " + worst.toFixed(3) + " exceeds tolerance");

  // Scenario B: dragging a marble hard through a settled pile
  var list2 = [];
  for(var k=0;k<9;k++) list2.push(mkMarble(50 + (Math.random()*16-8), 60 + k*1.5));
  simulate(list2, 6);
  assert.ok(allSettled(list2), "precondition: pile settled");
  var held = list2[0];
  held.settled = false; held.slowTime = 0;
  held._tx = held.x; held._ty = held.y;
  var worstDrag = 0;
  for(var g=0; g<120; g++){
    held._tx = 50 + Math.cos(g/120*Math.PI*2)*18;
    held._ty = 70 + Math.sin(g/120*Math.PI*2)*14;
    var acc2 = 0;
    while(acc2 < FRAME){
      P.stepPhysics(list2, STEP, held);
      acc2 += STEP;
    }
    P.updateSleep(list2, FRAME, held);
    worstDrag = Math.max(worstDrag, maxPenetration(list2));
  }
  assert.ok(worstDrag <= P.SLOP + 0.6,
    "drag penetration " + worstDrag.toFixed(3) + " exceeds tolerance");
  simulate(list2, 6);
  assert.ok(allSettled(list2), "pile did not re-settle after violent drag");
  list2.forEach(function(m){ assert.ok(insideBounds(m)); });
});

/* 9. No NaN over long chaos runs. */
test("no NaN under chaotic multi-marble interaction", function(){
  var list = [];
  for(var i=0;i<14;i++){
    var m = mkMarble(30 + Math.random()*40, 35 + Math.random()*30);
    m.vx = (Math.random()-0.5)*400;
    m.vy = (Math.random()-0.5)*400;
    list.push(m);
  }
  simulate(list, 10);
  list.forEach(function(m, i){
    assert.ok(isFinite(m.x) && isFinite(m.y) && isFinite(m.vx) && isFinite(m.vy), "marble " + i + " went NaN");
  });
  assert.ok(allSettled(list), "chaos did not calm down after 10s");
});

console.log(passed + " test(s) passed" + (process.exitCode ? " (with failures)" : ""));
