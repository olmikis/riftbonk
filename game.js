(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const nativeRandom = Math.random;
  const seedHash = value => {let h=2166136261;for(const char of String(value)){h^=char.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0)||0x6d2b79f5;};
  const seededValue = holder => {let t=holder.value=(holder.value+0x6d2b79f5)>>>0;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
  const gameRandom = () => {if(state?.seedState==null)return nativeRandom();let t=state.seedState=(state.seedState+0x6d2b79f5)>>>0;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
  const rand = (a = 1, b = 0) => b + gameRandom() * (a - b);
  const normalizeSeed = value => String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  const randomSeed = () => Math.floor(nativeRandom()*0xffffffff).toString(36).toUpperCase().padStart(6,'0').slice(-6);
  const TAU = Math.PI * 2;
  const ENEMY_XP_RATE = .99;
  const LATE_LEVEL_XP_MULTIPLIER = 1.20;
  const ATTACK_FADE_ENTER = 55, ATTACK_FADE_EXIT = 40, ATTACK_OVERLOAD_ALPHA = .10;
  const AOE_VISUAL_ENTER_COUNT = 20, AOE_VISUAL_EXIT_COUNT = 14, AOE_VISUAL_BUDGET = 24, AOE_VISUAL_HARD_LIMIT = 28;
  const WEAPON_SLOT_LIMIT = 5, ITEM_SLOT_LIMIT = 8;
  const CONSUMABLE_BASE_CHANCE = .012, CONSUMABLE_CHANCE_CAP = .02;
  const SPAWN_THREAT_BANK_CAP = 300;
  const BOSS_SINGLE_HIT_CAP = .42;
  const BOSS_DAMAGE_SOFT_CAP = .085, MINIBOSS_DAMAGE_SOFT_CAP = .12;
  const ENEMY_HEALTH_TIME_EXPONENT = 1.22;
  const ENEMY_DAMAGE_SCALING_RATE = .5;
  const LATE_BOSS_MAX_HEALTH_SCALE = 3.8;
  const SEISMIC_EDGE_DAMAGE_MULTIPLIER = .5;
  const VOID_PRESSURE_TICK_INTERVAL = .45;
  const SCREEN_SHAKE_SCALE = .4;
  const FX_GLOW_SCALE = .7;
  const ADAPTIVE_HEALTH_MAX = 1.25;
  const TELEMETRY_ENABLED = false;
  const BALANCE_REPORT_VERSION = 2, BALANCE_SAMPLE_INTERVAL = 5;
  const RENDER_SCALE_DEFAULT = .8, RENDER_SCALE_MIN = .5, RENDER_SCALE_MAX = 1;
  let renderScale=RENDER_SCALE_DEFAULT;
  try{const storedRenderScale=localStorage.getItem('riftRenderScale'),savedRenderScale=Number(storedRenderScale);if(storedRenderScale!==null&&Number.isFinite(savedRenderScale))renderScale=clamp(savedRenderScale,RENDER_SCALE_MIN,RENDER_SCALE_MAX);}catch(_error){}
  const RUN_PACES = {
    standard:{duration:1800,timelineScale:1,xpPace:1.05},
    rush:{duration:600,timelineScale:3,xpPace:2.5}
  };
  function xpNeedForLevel(level){
    if(level<=1)return 8;
    const regularNeed=current=>Math.floor((7+current**1.38*2.25)*(current>10?LATE_LEVEL_XP_MULTIPLIER:1)*(1+clamp((current-60)*.01,0,.40)));
    if(level<=100)return regularNeed(level);
    let need=regularNeed(100);for(let current=101;current<=level;current++)need=Math.floor(need*1.35);
    return need;
  }
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  const formatTime = (seconds) => {
    seconds = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };

  // ---------- Tiny dependency-free WebGL2 renderer ----------
  const canvas = $('#game');
  const combatTextLayer = $('#combatTextLayer');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) {
    document.body.innerHTML = '<div style="padding:40px;color:white;font-family:sans-serif">Нужен браузер с поддержкой WebGL 2. Откройте игру в актуальном Chrome, Edge или Firefox.</div>';
    return;
  }

  const vertexSource = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aNormal;
    layout(location=2) in vec4 aM0;
    layout(location=3) in vec4 aM1;
    layout(location=4) in vec4 aM2;
    layout(location=5) in vec4 aM3;
    layout(location=6) in vec4 aColor;
    uniform mat4 uViewProjection;
    out vec3 vNormal;
    out vec3 vWorld;
    out vec4 vColor;
    void main() {
      mat4 model = mat4(aM0, aM1, aM2, aM3);
      vec4 world = model * vec4(aPosition, 1.0);
      vWorld = world.xyz;
      vNormal = normalize(mat3(model) * aNormal);
      vColor = aColor;
      gl_Position = uViewProjection * world;
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    in vec3 vNormal;
    in vec3 vWorld;
    in vec4 vColor;
    uniform vec3 uCamera;
    uniform vec3 uFogColor;
    uniform vec3 uPlayerLight;
    uniform vec3 uArenaAccent;
    uniform vec3 uArenaSecondary;
    uniform float uRtx;
    uniform float uTime;
    out vec4 outColor;
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(uCamera-vWorld);
      vec3 lightDir = normalize(vec3(-0.62, 1.0, 0.28));
      float rawDiffuse = max(dot(normal, lightDir), 0.0);
      float diffuse = floor(rawDiffuse * 4.0) / 3.0;
      float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.4);
      float chroma = max(vColor.r,max(vColor.g,vColor.b))-min(vColor.r,min(vColor.g,vColor.b));
      float emissive = smoothstep(0.32,0.82,max(vColor.r,max(vColor.g,vColor.b))) * smoothstep(0.08,0.48,chroma);
      vec3 color = vColor.rgb * (0.28 + diffuse * 0.74);
      color += mix(vec3(0.18,0.55,0.52),vColor.rgb,.62) * rim * (.22 + emissive*.58);

      // The arena itself is a giant dormant circuit: square seams, radial seals and
      // a slow travelling scan wake up only on upward-facing surfaces near ground.
      float groundMask = (1.0-smoothstep(-0.02,0.22,vWorld.y))*smoothstep(.72,.93,normal.y);
      vec2 gridCell = abs(fract(vWorld.xz*.25)-.5);
      float gridLine = 1.0-smoothstep(.462,.493,max(gridCell.x,gridCell.y));
      float radius = length(vWorld.xz);
      float seal = 1.0-smoothstep(.018,.055,abs(fract(radius*.092-uTime*.018)-.5));
      float rune = max(gridLine*.30,seal*.42) * groundMask;
      vec3 runeColor = mix(uArenaAccent,uArenaSecondary,smoothstep(.55,.95,seal));
      color += runeColor*rune;
      color += vColor.rgb*emissive*(.06+.055*sin(uTime*3.0+vWorld.x+vWorld.z));
      if (uRtx > 0.5) {
        vec3 fillDir = normalize(vec3(0.55, 0.65, -0.75));
        float fill = max(dot(normal, fillDir), 0.0);
        vec3 halfDir = normalize(lightDir + viewDir);
        float material = max(max(vColor.r, vColor.g), vColor.b);
        float specular = pow(max(dot(normal, halfDir), 0.0), 28.0) * material;
        vec3 toPoint = uPlayerLight-vWorld;
        float pointDistance = max(length(toPoint), 0.001);
        float pointDiffuse = max(dot(normal, toPoint/pointDistance), 0.0);
        float attenuation = 1.0/(1.0+0.075*pointDistance*pointDistance);
        float pulse = 0.94+sin(uTime*2.4)*0.06;
        color = vColor.rgb*(0.19+diffuse*0.8+fill*0.2);
        color += mix(vec3(.2,.82,.72),vColor.rgb,.5)*rim*.7;
        color += vec3(0.16,0.95,0.78)*pointDiffuse*attenuation*1.42*pulse*(0.3+material*0.7);
        color += vec3(1.0,.78,.38)*specular*.38;
        color += runeColor*rune*1.65+vColor.rgb*emissive*.12;
      }
      float fog = smoothstep(mix(28.0,35.0,uRtx), mix(61.0,76.0,uRtx), distance(vWorld.xz, uCamera.xz));
      outColor = vec4(mix(color, uFogColor, fog), vColor.a);
    }`;

  function makeShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const program = gl.createProgram();
  gl.attachShader(program, makeShader(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, makeShader(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uVP = gl.getUniformLocation(program, 'uViewProjection');
  const uCamera = gl.getUniformLocation(program, 'uCamera');
  const uFogColor = gl.getUniformLocation(program, 'uFogColor');
  const uPlayerLight = gl.getUniformLocation(program, 'uPlayerLight');
  const uArenaAccent = gl.getUniformLocation(program, 'uArenaAccent');
  const uArenaSecondary = gl.getUniformLocation(program, 'uArenaSecondary');
  const uRtx = gl.getUniformLocation(program, 'uRtx');
  const uTime = gl.getUniformLocation(program, 'uTime');

  function tri(out, a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1, n = [nx / l, ny / l, nz / l];
    for (const p of [a, b, c]) out.push(...p, ...n);
  }
  function cubeGeometry() {
    const o = [], p = [
      [-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],
      [-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]
    ];
    for (const f of [[4,5,6,7],[1,0,3,2],[0,4,7,3],[5,1,2,6],[3,7,6,2],[0,1,5,4]]) {
      tri(o,p[f[0]],p[f[1]],p[f[2]]); tri(o,p[f[0]],p[f[2]],p[f[3]]);
    }
    return o;
  }
  function octaGeometry() {
    const o=[], t=[0,.62,0], b=[0,-.62,0], p=[[.55,0,0],[0,0,.55],[-.55,0,0],[0,0,-.55]];
    for(let i=0;i<4;i++){tri(o,t,p[i],p[(i+1)%4]);tri(o,b,p[(i+1)%4],p[i]);}
    return o;
  }
  function cylinderGeometry(n=10) {
    const o=[];
    for(let i=0;i<n;i++){
      const a=i/n*TAU,c=(i+1)/n*TAU;
      const p1=[Math.cos(a)*.5,-.5,Math.sin(a)*.5],p2=[Math.cos(c)*.5,-.5,Math.sin(c)*.5];
      const p3=[Math.cos(c)*.5,.5,Math.sin(c)*.5],p4=[Math.cos(a)*.5,.5,Math.sin(a)*.5];
      tri(o,p1,p2,p3);tri(o,p1,p3,p4);tri(o,[0,.5,0],p4,p3);tri(o,[0,-.5,0],p2,p1);
    }
    return o;
  }
  function pyramidGeometry() {
    const o=[], a=[-.5,-.5,-.5],b=[.5,-.5,-.5],c=[.5,-.5,.5],d=[-.5,-.5,.5],t=[0,.65,0];
    tri(o,a,b,t);tri(o,b,c,t);tri(o,c,d,t);tri(o,d,a,t);tri(o,a,d,c);tri(o,a,c,b);return o;
  }
  function ringGeometry(n=32,inner=.37) {
    const o=[],y=.5;
    for(let i=0;i<n;i++){
      const a=i/n*TAU,b=(i+1)/n*TAU;
      const ao=[Math.cos(a)*.5,y,Math.sin(a)*.5],bo=[Math.cos(b)*.5,y,Math.sin(b)*.5];
      const ai=[Math.cos(a)*inner,y,Math.sin(a)*inner],bi=[Math.cos(b)*inner,y,Math.sin(b)*inner];
      const aob=[ao[0],-y,ao[2]],bob=[bo[0],-y,bo[2]],aib=[ai[0],-y,ai[2]],bib=[bi[0],-y,bi[2]];
      tri(o,ao,bo,bi);tri(o,ao,bi,ai);tri(o,aob,bib,bob);tri(o,aob,aib,bib);
      tri(o,ao,aob,bob);tri(o,ao,bob,bo);tri(o,ai,bi,bib);tri(o,ai,bib,aib);
    }
    return o;
  }

  class Mesh {
    constructor(vertices) {
      this.count = vertices.length / 6;
      this.vao = gl.createVertexArray();
      this.instances = gl.createBuffer();
      gl.bindVertexArray(this.vao);
      const verts = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, verts);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      const stride = 20 * 4;
      for(let i=0;i<4;i++){gl.enableVertexAttribArray(2+i);gl.vertexAttribPointer(2+i,4,gl.FLOAT,false,stride,i*16);gl.vertexAttribDivisor(2+i,1);}
      gl.enableVertexAttribArray(6);gl.vertexAttribPointer(6,4,gl.FLOAT,false,stride,64);gl.vertexAttribDivisor(6,1);
      gl.bindVertexArray(null);
    }
    draw(data) {
      if (!data.length) return;
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.count, data.length / 20);
    }
  }
  const meshes = { cube:new Mesh(cubeGeometry()), octa:new Mesh(octaGeometry()), cylinder:new Mesh(cylinderGeometry(12)), pyramid:new Mesh(pyramidGeometry()), ring:new Mesh(ringGeometry()) };
  const batches = { cube:[], octa:[], cylinder:[], pyramid:[], ring:[] };
  function add(mesh, x,y,z, sx,sy,sz, ry, color) {
    const c=Math.cos(ry||0),s=Math.sin(ry||0),o=batches[mesh];
    o.push(c*sx,0,-s*sx,0, 0,sy,0,0, s*sz,0,c*sz,0, x,y,z,1, ...color);
  }
  function mat4Perspective(fovy, aspect, near, far) {
    const f=1/Math.tan(fovy/2),nf=1/(near-far);
    return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);
  }
  function mat4LookAt(e,c,u=[0,1,0]) {
    let z0=e[0]-c[0],z1=e[1]-c[1],z2=e[2]-c[2],l=Math.hypot(z0,z1,z2);z0/=l;z1/=l;z2/=l;
    let x0=u[1]*z2-u[2]*z1,x1=u[2]*z0-u[0]*z2,x2=u[0]*z1-u[1]*z0;l=Math.hypot(x0,x1,x2);x0/=l;x1/=l;x2/=l;
    const y0=z1*x2-z2*x1,y1=z2*x0-z0*x2,y2=z0*x1-z1*x0;
    return new Float32Array([x0,y0,z0,0,x1,y1,z1,0,x2,y2,z2,0,-(x0*e[0]+x1*e[1]+x2*e[2]),-(y0*e[0]+y1*e[1]+y2*e[2]),-(z0*e[0]+z1*e[1]+z2*e[2]),1]);
  }
  function mat4Multiply(a,b) {
    const o=new Float32Array(16);
    for(let i=0;i<4;i++)for(let j=0;j<4;j++)o[j*4+i]=a[i]*b[j*4]+a[4+i]*b[j*4+1]+a[8+i]*b[j*4+2]+a[12+i]*b[j*4+3];
    return o;
  }
  function resize() {
    const d=Math.min(devicePixelRatio||1,1.7)*renderScale,w=Math.max(2,Math.floor(innerWidth*d)),h=Math.max(2,Math.floor(innerHeight*d));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);canvas.dataset.renderResolution=`${w}x${h}`;}
  }
  function setRenderScale(value,persist=true){
    const numeric=Number(value),next=Number.isFinite(numeric)?numeric:RENDER_SCALE_DEFAULT;
    renderScale=Math.round(clamp(next,RENDER_SCALE_MIN,RENDER_SCALE_MAX)*20)/20;
    const percent=Math.round(renderScale*100),input=$('#renderScaleInput'),label=$('#renderScaleValue');
    if(input&&Number(input.value)!==percent)input.value=String(percent);if(label)label.textContent=`${percent}%`;
    canvas.dataset.renderScale=String(renderScale);if(persist)try{localStorage.setItem('riftRenderScale',String(renderScale));}catch(_error){}resize();
  }

  // ---------- Data ----------
  const COLORS = {
    cyan:[.20,1,.83,1], violet:[.55,.28,1,1], amber:[1,.68,.22,1], red:[1,.035,.16,1],
    green:[.32,1,.58,1], white:[.92,.91,.82,1], ground:[.022,.035,.034,1], line:[.055,.20,.18,1],
    shadow:[.002,.006,.006,.48], pink:[1,.16,.52,1], brass:[.53,.31,.09,1], stone:[.045,.062,.058,1]
  };
  const BASIC_MONSTER_MODEL_TYPES=new Set(['grunt','runner','brute','swarm','titan']);
  const BASIC_MONSTER_MODEL_CAP=64,BASIC_MONSTER_ANIMATED_CAP=18,BASIC_MONSTER_ANIMATION_DISTANCE=18;
  const ARENA_THEMES = [
    {id:'temple',name:'ОБСИДИАНОВЫЙ ХРАМ',ground:[.022,.035,.034,1],groundAlt:[.027,.042,.039,1],accent:[.08,.48,.39],secondary:[.72,.45,.12],line:[.055,.20,.18,1],fog:[.009,.021,.019]},
    {id:'forge',name:'ЛАТУННАЯ ФАБРИКА',ground:[.044,.031,.021,1],groundAlt:[.055,.038,.022,1],accent:[.56,.24,.055],secondary:[.95,.57,.13],line:[.28,.12,.035,1],fog:[.027,.014,.009]},
    {id:'blight',name:'ЗАРАЖЁННЫЙ КОНТУР',ground:[.021,.042,.026,1],groundAlt:[.027,.052,.029,1],accent:[.18,.55,.19],secondary:[.54,.79,.12],line:[.07,.24,.09,1],fog:[.008,.026,.012]},
    {id:'void',name:'ФИОЛЕТОВАЯ ПУСТОТА',ground:[.027,.022,.048,1],groundAlt:[.036,.026,.061,1],accent:[.31,.13,.58],secondary:[.16,.55,.66],line:[.13,.065,.28,1],fog:[.014,.008,.031]}
  ];
  function arenaTheme(time=state?.time||0){
    if(state?.mode==='menu')return{...ARENA_THEMES[0],index:0,nextIndex:0,mix:0};
    const timeline=Math.max(0,runTimelineTime(time)),segment=Math.min(ARENA_THEMES.length-1,Math.floor(timeline/450)),local=(timeline-segment*450)/450,nextIndex=Math.min(ARENA_THEMES.length-1,segment+1),mix=nextIndex===segment?0:clamp((local-.72)/.28,0,1),smooth=mix*mix*(3-2*mix),from=ARENA_THEMES[segment],to=ARENA_THEMES[nextIndex],blend=(a,b)=>a.map((value,index)=>lerp(value,b[index],smooth));
    return{id:mix>.5?to.id:from.id,name:mix>.5?to.name:from.name,index:segment,nextIndex,mix:smooth,ground:blend(from.ground,to.ground),groundAlt:blend(from.groundAlt,to.groundAlt),accent:blend(from.accent,to.accent),secondary:blend(from.secondary,to.secondary),line:blend(from.line,to.line),fog:blend(from.fog,to.fog)};
  }
  function arenaPylonPlacement(index){
    const angle=index/18*TAU,radius=34+(index%3)*7;
    return{angle,x:Math.cos(angle)*radius,z:Math.sin(angle)*radius,height:4+(index%4)};
  }
  let threeArenaRenderer=null;
  function ensureThreeArenaRenderer(){
    if(threeArenaRenderer!==null)return threeArenaRenderer||null;
    const THREE=window.THREE;if(!THREE?.WebGLRenderer){threeArenaRenderer=false;return null;}
    try{
      const renderer=new THREE.WebGLRenderer({canvas,context:gl,antialias:true,alpha:false});
      renderer.autoClear=true;renderer.shadowMap.type=THREE.VSMShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
      const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,1,.1,110),clearColor=new THREE.Color(),scratchColor=new THREE.Color(),matrixDummy=new THREE.Object3D(),scratchMatrix=new THREE.Matrix4(),scratchInstanceColor=new THREE.Color();camera.layers.enable(1);
      scene.fog=new THREE.FogExp2(0x05090b,.012);

      const floorMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.72,metalness:.34}),floorGeometry=new THREE.BoxGeometry(3.94,.5,3.94),floor=new THREE.InstancedMesh(floorGeometry,floorMaterial,21*19);
      floor.instanceMatrix.setUsage(THREE.DynamicDrawUsage);floor.receiveShadow=true;floor.frustumCulled=false;scene.add(floor);
      const grid=new THREE.GridHelper(84,21,0x32e6c1,0x173c36);grid.position.y=.012;grid.material.transparent=true;grid.material.opacity=.34;grid.material.depthWrite=false;scene.add(grid);

      const pylonMaterial=new THREE.MeshStandardMaterial({color:0x111a1b,roughness:.48,metalness:.72}),crystalMaterial=new THREE.MeshStandardMaterial({color:0x39f4cd,emissive:0x1bd8b4,emissiveIntensity:2.4,roughness:.22,metalness:.18}),pylonBases=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),pylonMaterial,18),pylonCrystals=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.68,0),crystalMaterial,18);
      pylonBases.instanceMatrix.setUsage(THREE.DynamicDrawUsage);pylonCrystals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);pylonBases.castShadow=true;pylonBases.receiveShadow=true;pylonCrystals.castShadow=true;pylonBases.frustumCulled=false;pylonCrystals.frustumCulled=false;scene.add(pylonBases,pylonCrystals);

      // A restrained amount of drifting rift dust; no camera-following floor decorations.
      const dustCount=180,dustPositions=new Float32Array(dustCount*3),dustWorldX=new Float32Array(dustCount),dustWorldZ=new Float32Array(dustCount),dustSpeeds=new Float32Array(dustCount);for(let i=0;i<dustCount;i++){const angle=(i*.61803398875%1)*TAU,radius=5+((i*47)%100)/100*41,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;dustPositions[i*3]=dustWorldX[i]=x;dustPositions[i*3+1]=.35+((i*31)%100)/100*14;dustPositions[i*3+2]=dustWorldZ[i]=z;dustSpeeds[i]=.18+((i*17)%37)/37*.42;}
      const dustGeometry=new THREE.BufferGeometry();dustGeometry.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));const dustMaterial=new THREE.PointsMaterial({color:0x39f4cd,size:.08,transparent:true,opacity:.22,depthWrite:false,sizeAttenuation:true,blending:THREE.AdditiveBlending}),riftDust=new THREE.Points(dustGeometry,dustMaterial);riftDust.frustumCulled=false;riftDust.renderOrder=2;scene.add(riftDust);

      const hemisphere=new THREE.HemisphereLight(0x8fcfc7,0x07100f,.82),ambient=new THREE.AmbientLight(0xffffff,.12),sun=new THREE.DirectionalLight(0xffd7a0,2.7),sunTarget=new THREE.Object3D(),playerLight=new THREE.PointLight(0x36f5d0,72,24,2),sideLightA=new THREE.PointLight(0xffa128,42,16,2),sideLightB=new THREE.PointLight(0x7b55ff,36,15,2);
      sun.castShadow=true;sun.shadow.mapSize.set(512,512);sun.shadow.camera.left=-34;sun.shadow.camera.right=34;sun.shadow.camera.top=34;sun.shadow.camera.bottom=-34;sun.shadow.camera.near=1;sun.shadow.camera.far=82;sun.shadow.bias=-.00045;sun.shadow.normalBias=.025;sun.target=sunTarget;playerLight.layers.set(1);sideLightA.layers.set(1);sideLightB.layers.set(1);scene.add(hemisphere,ambient,sun,sunTarget,playerLight,sideLightA,sideLightB);
      const effectLights=Array.from({length:3},()=>{const light=new THREE.PointLight(0xffffff,0,8,2);light.layers.set(1);light.visible=false;scene.add(light);return light;});

      // Test character model. It is visual only: gameplay position and hitbox remain unchanged.
      let pocketRoot=null,pocketLoadState='loading';canvas.dataset.pocketModel=pocketLoadState;
      async function loadPocketModel(){
        try{
          const [{GLTFLoader},{DRACOLoader},MODEL_THREE]=await Promise.all([import('./vendor/GLTFLoader.js'),import('./vendor/DRACOLoader.js'),import('./vendor/three.module.js')]),dracoLoader=new DRACOLoader();
          dracoLoader.setDecoderPath('./vendor/draco/');dracoLoader.setDecoderConfig({type:'js'});dracoLoader.setWorkerLimit(2);
          const loader=new GLTFLoader();loader.setDRACOLoader(dracoLoader);const gltf=await loader.loadAsync('./models/Pocket.glb'),model=gltf.scene,rawBox=new MODEL_THREE.Box3().setFromObject(model),rawSize=new MODEL_THREE.Vector3();rawBox.getSize(rawSize);const height=Math.max(.001,rawSize.y),scale=2.15/height;model.scale.multiplyScalar(scale);model.updateMatrixWorld(true);
          const scaledBox=new MODEL_THREE.Box3().setFromObject(model),center=new MODEL_THREE.Vector3();scaledBox.getCenter(center);model.position.x-=center.x;model.position.y-=scaledBox.min.y;model.position.z-=center.z;model.updateMatrixWorld(true);model.traverse(object=>{if(!object.isMesh)return;object.castShadow=true;object.receiveShadow=true;object.frustumCulled=true;if(object.material){const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials)material.needsUpdate=true;}});
          pocketRoot=new MODEL_THREE.Group();pocketRoot.name='PocketHeroTest';pocketRoot.visible=false;pocketRoot.add(model);scene.add(pocketRoot);pocketLoadState='ready';canvas.dataset.pocketModel=pocketLoadState;canvas.dataset.pocketModelMeshes=String(gltf.scene.children.length);dracoLoader.dispose();
        }catch(error){pocketLoadState='error';canvas.dataset.pocketModel=pocketLoadState;canvas.dataset.pocketModelError=String(error?.message||error);console.warn('Pocket.glb disabled, using the original hero:',error);}
      }
      function updatePocketModel(visual,time){
        if(!pocketRoot)return;pocketRoot.visible=Boolean(visual?.visible);if(!pocketRoot.visible)return;const direction=Number(visual.dir)||0,bob=visual.menu?Math.sin(time*.0022)*.035:visual.moving?Math.abs(Math.sin(time*.012))*0.055:Math.sin(time*.0028)*.018;pocketRoot.position.set(Number(visual.x)||0,bob,Number(visual.z)||0);pocketRoot.rotation.set(0,Math.PI*.5-direction,0);
      }
      loadPocketModel();

      // Animated base-monster LOD. Near enemies use a throttled skeletal clip;
      // farther pooled models keep their last pose, and the outer renderer keeps
      // the cheapest primitive LOD once this bounded pool is full.
      let monsterTemplate=null,monsterClip=null,monsterClone=null,monsterModelThree=null,monsterLoadState='loading',monsterAnimationLastTick=0;
      const monsterPool=[];canvas.dataset.monsterModel=monsterLoadState;
      async function loadMonsterModel(){
        try{
          const [{GLTFLoader},{DRACOLoader},SkeletonUtils,MODEL_THREE]=await Promise.all([import('./vendor/GLTFLoader.js'),import('./vendor/DRACOLoader.js'),import('./vendor/SkeletonUtils.js'),import('./vendor/three.module.js')]),dracoLoader=new DRACOLoader();
          dracoLoader.setDecoderPath('./vendor/draco/');dracoLoader.setDecoderConfig({type:'js'});dracoLoader.setWorkerLimit(2);
          const loader=new GLTFLoader();loader.setDRACOLoader(dracoLoader);const gltf=await loader.loadAsync('./models/monster01.glb'),model=gltf.scene,rawBox=new MODEL_THREE.Box3().setFromObject(model),rawSize=new MODEL_THREE.Vector3();rawBox.getSize(rawSize);const height=Math.max(.001,rawSize.y),scale=2.3125/height;model.scale.multiplyScalar(scale);model.updateMatrixWorld(true);
          const scaledBox=new MODEL_THREE.Box3().setFromObject(model),center=new MODEL_THREE.Vector3();scaledBox.getCenter(center);model.position.x-=center.x;model.position.y-=scaledBox.min.y;model.position.z-=center.z;model.updateMatrixWorld(true);let meshCount=0;model.traverse(object=>{if(!object.isMesh)return;meshCount++;object.castShadow=true;object.receiveShadow=true;object.frustumCulled=true;if(object.material){const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials)material.needsUpdate=true;}});
          monsterTemplate=new MODEL_THREE.Group();monsterTemplate.name='BaseMonsterTemplate';monsterTemplate.add(model);monsterClip=gltf.animations[0]||null;monsterClone=SkeletonUtils.clone;monsterModelThree=MODEL_THREE;monsterLoadState='ready';canvas.dataset.monsterModel=monsterLoadState;canvas.dataset.monsterModelMeshes=String(meshCount);canvas.dataset.monsterModelTriangles='656';canvas.dataset.monsterAnimation=monsterClip?.name||'none';dracoLoader.dispose();
        }catch(error){monsterLoadState='error';canvas.dataset.monsterModel=monsterLoadState;canvas.dataset.monsterModelError=String(error?.message||error);console.warn('monster01.glb disabled, using primitive enemy LODs:',error);}
      }
      function createMonsterPoolEntry(index){
        const root=monsterClone(monsterTemplate);root.name=`BaseMonsterLOD_${index}`;root.visible=false;root.traverse(object=>{if(!object.isMesh)return;object.castShadow=true;object.receiveShadow=true;});scene.add(root);const mixer=monsterClip?new monsterModelThree.AnimationMixer(root):null,action=mixer?mixer.clipAction(monsterClip):null;if(action){action.play();mixer.setTime((index*.173)%Math.max(.001,monsterClip.duration));}return{root,mixer};
      }
      function updateMonsterModels(visuals,time){
        const source=monsterTemplate&&Array.isArray(visuals)?visuals:[],count=Math.min(BASIC_MONSTER_MODEL_CAP,source.length);while(monsterPool.length<count)monsterPool.push(createMonsterPoolEntry(monsterPool.length));
        const tickInterval=1000/12,tick=time-monsterAnimationLastTick>=tickInterval,animationDelta=tick?Math.min(.12,monsterAnimationLastTick?(time-monsterAnimationLastTick)/1000:tickInterval/1000):0;if(tick)monsterAnimationLastTick=time;let animated=0,frozen=0;
        for(let i=0;i<monsterPool.length;i++){const entry=monsterPool[i],visual=i<count?source[i]:null;entry.root.visible=Boolean(visual);if(!visual)continue;const scale=Math.max(.2,Number(visual.size)||1);entry.root.position.set(Number(visual.x)||0,-.83*scale,Number(visual.z)||0);entry.root.rotation.set(0,Math.PI*.5-(Number(visual.dir)||0),0);entry.root.scale.setScalar(scale);if(visual.animate){animated++;if(tick&&entry.mixer)entry.mixer.update(animationDelta);}else frozen++;}
        canvas.dataset.monsterModelVisible=String(count);canvas.dataset.monsterModelAnimated=String(animated);canvas.dataset.monsterModelFrozen=String(frozen);canvas.dataset.monsterAnimationFps='12';canvas.dataset.monsterModelPool=String(monsterPool.length);
      }
      loadMonsterModel();

      // Shader-only weapon VFX. Projectiles/beams use tight cards; radial zones use one tiny 16-sided disc.
      const fxVertex='attribute vec3 iPos;attribute vec2 iDir;attribute vec2 iScale;attribute vec4 iColor;attribute vec4 iData;varying vec2 vUv;varying vec4 vColor;varying vec4 vData;void main(){vec2 forward=normalize(iDir+vec2(.00001,0.0));vec2 side=vec2(-forward.y,forward.x);vec2 offset=forward*position.x*iScale.x+side*position.y*iScale.y;vec3 world=vec3(iPos.x+offset.x,iPos.y,iPos.z+offset.y);vUv=uv;vColor=iColor;vData=iData;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);}';
      function createWeaponFxLayer(capacity,fragmentShader,shape='card'){
        const primitive=shape==='disc'?new THREE.CircleGeometry(.5,16):new THREE.PlaneGeometry(1,1),geometry=new THREE.InstancedBufferGeometry();geometry.index=primitive.index;geometry.setAttribute('position',primitive.attributes.position.clone());geometry.setAttribute('uv',primitive.attributes.uv.clone());const arrays={iPos:new Float32Array(capacity*3),iDir:new Float32Array(capacity*2),iScale:new Float32Array(capacity*2),iColor:new Float32Array(capacity*4),iData:new Float32Array(capacity*4)};for(const [name,array] of Object.entries(arrays)){const size=name==='iPos'?3:name==='iDir'||name==='iScale'?2:4,attribute=new THREE.InstancedBufferAttribute(array,size);attribute.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute(name,attribute);}geometry.instanceCount=0;const material=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uQuality:{value:0}},vertexShader:fxVertex,fragmentShader,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false}),mesh=new THREE.Mesh(geometry,material);mesh.layers.enable(1);mesh.frustumCulled=false;mesh.renderOrder=5;scene.add(mesh);return{capacity,geometry,material,mesh,arrays};
      }
      const fxNoise='float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}';
      const projectileFx=createWeaponFxLayer(6000,`uniform float uTime;varying vec2 vUv;varying vec4 vColor;varying vec4 vData;${fxNoise}void main(){vec2 p=vUv*2.0-1.0;float type=vData.x,seed=vData.z,shape=0.0,core=0.0;if(type>2.5){float r=length(p);float ring=smoothstep(.95,.48,r)*smoothstep(.22,.48,r);float teeth=.56+.44*sin(atan(p.y,p.x)*10.0+uTime*12.0+seed);shape=ring*(.55+.45*teeth);core=smoothstep(.72,.12,r)*.55;}else{float jitter=(noise(vec2(p.x*4.0+uTime*5.0+seed,p.y*5.0))-0.5)*.16;float width=type>1.5?.52:type>.5?.30:.42;float body=smoothstep(width,0.0,abs(p.y+jitter));float head=smoothstep(1.0,.15,length(vec2((p.x-.56)*1.45,p.y)));float tail=smoothstep(-1.0,.58,p.x)*(1.0-smoothstep(.58,1.0,p.x));shape=max(head,body*tail*(.35+.65*smoothstep(-1.0,.4,p.x)));if(type>.5&&type<1.5)shape*=.72+.28*sin((p.x+uTime*2.0+seed)*24.0);if(type>1.5)shape*=.68+.32*noise(p*7.0+seed+uTime*3.0);core=head+body*tail*.55;}float alpha=clamp(shape*vColor.a,0.0,1.0);if(alpha<.012)discard;vec3 color=vColor.rgb*(.72+core*1.65);gl_FragColor=vec4(color,alpha);}`);
      const beamFx=createWeaponFxLayer(2048,`uniform float uTime;varying vec2 vUv;varying vec4 vColor;varying vec4 vData;${fxNoise}void main(){vec2 p=vUv*2.0-1.0;p.y*=vData.w;float type=vData.x,seed=vData.z,fade=sin(vUv.x*3.1415926),offset=0.0,width=.16;if(type<.5){float n1=noise(vec2(p.x*7.0+uTime*9.0+seed,seed))-0.5;float n2=noise(vec2(p.x*17.0-uTime*13.0,seed+4.2))-0.5;offset=(n1*.62+n2*.25)*fade;width=.13;}else if(type<1.5){offset=sin(p.x*18.0+uTime*7.0+seed)*.035;width=.19;}else{offset=(noise(vec2(p.x*5.0+seed,uTime*2.0))-0.5)*.12;width=.24;}float d=abs(p.y-offset),core=smoothstep(width*.34,0.0,d),glow=smoothstep(width*2.8,0.0,d);if(type<.5){float branch=abs(p.y+offset*.7-.34*sin(p.x*10.0+seed)*fade);glow=max(glow,smoothstep(.13,0.0,branch)*.42);}float edge=smoothstep(0.0,.08,vUv.x)*smoothstep(0.0,.08,1.0-vUv.x),alpha=(core+glow*.48)*edge*vColor.a;if(alpha<.012)discard;gl_FragColor=vec4(vColor.rgb*(glow*.8+core*2.3),clamp(alpha,0.0,1.0));}`);
      const zoneFx=createWeaponFxLayer(2048,`uniform float uTime;varying vec2 vUv;varying vec4 vColor;varying vec4 vData;${fxNoise}void main(){vec2 p=vUv*2.0-1.0;float r=length(p),a=atan(p.y,p.x),type=vData.x,progress=vData.y,seed=vData.z,shape=0.0,core=0.0;if(r>1.0)discard;if(type<.5){float flame=noise(p*6.0+vec2(0.0,-uTime*2.3+seed));shape=smoothstep(1.0,.1,r)*smoothstep(.28,.8,flame+(.82-r)*.55);core=smoothstep(.52,0.0,r)*flame;}else if(type<1.5){float swirl=.5+.5*sin(a*6.0-r*18.0-uTime*5.0+seed);shape=smoothstep(1.0,.16,r)*(.22+swirl*.62)+smoothstep(.34,.05,r);core=smoothstep(.28,0.0,r);}else if(type<2.5){float crystal=abs(sin(a*6.0+seed));shape=smoothstep(1.0,.72,r)*(.45+.55*crystal)+smoothstep(.09,.0,abs(r-progress));core=smoothstep(.55,0.0,r)*.45;}else if(type<3.5){float arcs=smoothstep(.82,.96,sin(a*9.0-r*22.0+uTime*8.0+seed));shape=smoothstep(1.0,.18,r)*arcs+smoothstep(.06,0.0,abs(r-.62));core=arcs*.5;}else if(type<4.5){float wave=abs(r-progress);shape=smoothstep(.10,.0,wave)+smoothstep(.035,.0,abs(r-progress*.66))*.55;core=smoothstep(.05,0.0,wave);}else if(type<5.5){float pulse=.62+.38*sin(uTime*9.0+seed);shape=smoothstep(.07,.0,abs(r-.86))*pulse+smoothstep(.22,0.0,r)*.45;core=smoothstep(.12,0.0,r);}else if(type<6.5){float ticks=smoothstep(.55,.95,sin(a*8.0+seed));shape=smoothstep(.08,.0,abs(r-.72))+.55*ticks*smoothstep(.82,.38,r)*smoothstep(.25,.48,r);core=smoothstep(.3,0.0,r)*.35;}else{float scar=smoothstep(.16,.0,abs(p.y+sin(p.x*9.0+seed)*.08));shape=scar*smoothstep(1.0,.1,abs(p.x));core=scar*.55;}float alpha=clamp(shape*vColor.a,0.0,1.0);if(alpha<.01)discard;gl_FragColor=vec4(vColor.rgb*(.66+core*1.8),alpha);}`,'disc');
      function playerFxRgb(color){const redLike=color[0]>(color[1]*1.8)&&color[0]>(color[2]*1.35);return redLike?COLORS.amber:color;}
      function writeFx(layer,index,pos,dir,scale,color,data){if(index>=layer.capacity)return false;layer.arrays.iPos.set(pos,index*3);layer.arrays.iDir.set(dir,index*2);layer.arrays.iScale.set(scale,index*2);layer.arrays.iColor.set(color,index*4);layer.arrays.iData.set(data,index*4);return true;}
      function finishFx(layer,count,time,rtx){layer.geometry.instanceCount=count;layer.mesh.visible=count>0;layer.material.uniforms.uTime.value=time*.001;layer.material.uniforms.uQuality.value=rtx?1:0;for(const name of ['iPos','iDir','iScale','iColor','iData'])layer.geometry.attributes[name].needsUpdate=true;}
      function updateWeaponFx(time,rtx,visible){
        const projectileSource=visible?.projectiles||projectiles,beamSource=visible?.beams||beams,zoneSource=visible?.zones||zones,overloadAlpha=playerAttacksFaded?ATTACK_OVERLOAD_ALPHA:1;let projectileCount=0,beamCount=0,zoneCount=0;
        for(let i=0;i<projectileSource.length&&projectileCount<projectileFx.capacity;i++){const p=projectileSource[i],speed=Math.hypot(p.vx,p.vz)||1,kind=p.kind||'',type=kind==='saw'||kind==='boomerang'?3:kind==='needle'||kind==='shard'?1:kind==='nanite'||kind==='drone'?2:0,size=Math.max(.06,p.size||.16),length=type===3?size*2.5:type===1?size*7:type===2?size*4:size*5,width=type===3?size*2.5:type===1?size*1.35:type===2?size*1.8:size*2,rgb=playerFxRgb(p.color||COLORS.cyan),alpha=overloadAlpha*(type===3?.9:.82);if(writeFx(projectileFx,projectileCount,[p.x,p.y||.8,p.z],[p.vx/speed,p.vz/speed],[length,width],[rgb[0],rgb[1],rgb[2],alpha],[type,clamp(p.life/Math.max(.01,p.max||p.life||1),0,1),(p.spin||0)+i*.73,1]))projectileCount++;}
        for(let i=0;i<beamSource.length&&beamCount<beamFx.capacity;i++){const b=beamSource[i];if(b.color===COLORS.red)continue;const dx=b.x2-b.x1,dz=b.z2-b.z1,length=Math.hypot(dx,dz)||.01,rgb=playerFxRgb(b.color||COLORS.cyan),kind=b.kind||'',type=kind==='prism'?1:kind==='rift'?2:0,alpha=overloadAlpha*.82,quadWidth=type===1?.30:type===2?.52:.56,uvCrop=type===1?.58:type===2?.72:.82;if(writeFx(beamFx,beamCount,[(b.x1+b.x2)*.5,1,(b.z1+b.z2)*.5],[dx/length,dz/length],[length,quadWidth],[rgb[0],rgb[1],rgb[2],alpha],[type,clamp(b.life/Math.max(.01,b.max||1),0,1),i*.91+(b.x1+b.z2)*.07,uvCrop]))beamCount++;}
        const zoneTypes={firetrail:0,gravity:1,frost:2,storm:3,seismic:4,pulse:4,meteor:5,mortar:5,mine:6,riftScar:7,blast:4};for(let i=0;i<zoneSource.length&&zoneCount<zoneFx.capacity;i++){const z=zoneSource[i];if(String(z.kind).startsWith('enemy'))continue;const rgb=playerFxRgb(z.color||COLORS.cyan),type=zoneTypes[z.kind]??4,progress=type===4?clamp(1-z.life/Math.max(.01,z.max||1),0,1):clamp(z.life/Math.max(.01,z.max||1),0,1),alpha=overloadAlpha*(type===0?.42:type===1?.36:type===5?.55:.48),radius=Math.max(.15,z.radius||1);if(writeFx(zoneFx,zoneCount,[z.x,.075,z.z],[1,0],[radius*2,radius*2],[rgb[0],rgb[1],rgb[2],alpha],[type,progress,(z.seed||0)+i*.63,1]))zoneCount++;}
        finishFx(projectileFx,projectileCount,time,rtx);finishFx(beamFx,beamCount,time,rtx);finishFx(zoneFx,zoneCount,time,rtx);canvas.dataset.shaderProjectiles=String(projectileCount);canvas.dataset.shaderBeams=String(beamCount);canvas.dataset.shaderZones=String(zoneCount);
      }

      // The gameplay renderer already assembles every visual as a matrix + RGBA.
      // Convert those streams to a small set of lit Three.js InstancedMeshes.
      function bufferGeometryFromLegacy(vertices){
        const positions=new Float32Array(vertices.length/2),normals=new Float32Array(vertices.length/2);
        for(let source=0,target=0;source<vertices.length;source+=6,target+=3){positions[target]=vertices[source];positions[target+1]=vertices[source+1];positions[target+2]=vertices[source+2];normals[target]=vertices[source+3];normals[target+1]=vertices[source+4];normals[target+2]=vertices[source+5];}
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.computeBoundingSphere();return geometry;
      }
      const primitiveGeometries={cube:bufferGeometryFromLegacy(cubeGeometry()),octa:bufferGeometryFromLegacy(octaGeometry()),cylinder:bufferGeometryFromLegacy(cylinderGeometry(12)),pyramid:bufferGeometryFromLegacy(pyramidGeometry()),ring:bufferGeometryFromLegacy(ringGeometry())};
      function makeOpaqueMaterial(){
        const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.48,metalness:.18});
        material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\n#ifdef USE_INSTANCING_COLOR\n  float instanceChroma=max(vColor.r,max(vColor.g,vColor.b))-min(vColor.r,min(vColor.g,vColor.b));\n  reflectedLight.directDiffuse+=vColor.rgb*(.035+smoothstep(.14,.68,instanceChroma)*.11);\n#endif');};
        material.customProgramCacheKey=()=> 'rift-lit-instances-v3';return material;
      }
      function makeTransparentMaterial(additive=false){
        const material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthWrite:false,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});
        material.onBeforeCompile=shader=>{
          shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;').replace('#include <begin_vertex>','vInstanceAlpha=instanceAlpha;\n#include <begin_vertex>');
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vInstanceAlpha;').replace('#include <opaque_fragment>','diffuseColor.a*=vInstanceAlpha;\n#include <opaque_fragment>');
        };
        material.customProgramCacheKey=()=> `rift-alpha-instances-v3-${additive?'add':'normal'}`;return material;
      }
      const instanceGroups={};
      function createInstanceMesh(kind,mode,capacity){
        const transparent=mode!=='opaque',additive=mode==='additive';
        const geometry=primitiveGeometries[kind].clone();
        if(transparent)geometry.setAttribute('instanceAlpha',new THREE.InstancedBufferAttribute(new Float32Array(capacity),1));
        const mesh=new THREE.InstancedMesh(geometry,transparent?makeTransparentMaterial(additive):makeOpaqueMaterial(),capacity);mesh.layers.enable(1);mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=!transparent;mesh.receiveShadow=!transparent;mesh.renderOrder=additive?4:transparent?3:1;scene.add(mesh);return mesh;
      }
      function makeInstanceGroup(kind,capacity=512){return{kind,capacity,opaque:createInstanceMesh(kind,'opaque',capacity),transparent:createInstanceMesh(kind,'transparent',capacity),additive:createInstanceMesh(kind,'additive',capacity)};}
      for(const kind of Object.keys(primitiveGeometries))instanceGroups[kind]=makeInstanceGroup(kind,kind==='cube'||kind==='octa'?1024:512);
      function growInstanceGroup(group,required){
        let capacity=group.capacity;while(capacity<required)capacity*=2;
        scene.remove(group.opaque,group.transparent,group.additive);group.opaque.geometry.dispose();group.transparent.geometry.dispose();group.additive.geometry.dispose();group.opaque.material.dispose();group.transparent.material.dispose();group.additive.material.dispose();group.capacity=capacity;group.opaque=createInstanceMesh(group.kind,'opaque',capacity);group.transparent=createInstanceMesh(group.kind,'transparent',capacity);group.additive=createInstanceMesh(group.kind,'additive',capacity);
      }
      function syncInstanceBatches(sourceBatches){
        let opaqueTotal=0,transparentTotal=0,additiveTotal=0,dropped=0;
        for(const [kind,data] of Object.entries(sourceBatches)){
          const itemCount=Math.floor(data.length/20),group=instanceGroups[kind];if(!group)continue;if(itemCount>group.capacity)growInstanceGroup(group,itemCount);
          let opaqueCount=0,transparentCount=0,additiveCount=0;
          for(let offset=0;offset<data.length;offset+=20){
            const alpha=clamp(Number(data[offset+19])||0,0,1),transparent=alpha<.985,maxColor=Math.max(data[offset+16],data[offset+17],data[offset+18]),minColor=Math.min(data[offset+16],data[offset+17],data[offset+18]),additive=transparent&&alpha<=.42&&maxColor>.38&&(maxColor-minColor>.12||maxColor>.8),target=additive?group.additive:transparent?group.transparent:group.opaque,index=additive?additiveCount++:transparent?transparentCount++:opaqueCount++;
            if(index>=group.capacity){dropped++;continue;}
            scratchMatrix.fromArray(data,offset);target.setMatrixAt(index,scratchMatrix);scratchInstanceColor.setRGB(Math.max(0,data[offset+16]),Math.max(0,data[offset+17]),Math.max(0,data[offset+18]));target.setColorAt(index,scratchInstanceColor);if(transparent)target.geometry.attributes.instanceAlpha.setX(index,alpha);
          }
          group.opaque.count=opaqueCount;group.transparent.count=transparentCount;group.additive.count=additiveCount;for(const mesh of [group.opaque,group.transparent,group.additive]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}group.transparent.geometry.attributes.instanceAlpha.needsUpdate=true;group.additive.geometry.attributes.instanceAlpha.needsUpdate=true;opaqueTotal+=opaqueCount;transparentTotal+=transparentCount;additiveTotal+=additiveCount;
        }
        canvas.dataset.threeOpaqueInstances=String(opaqueTotal);canvas.dataset.threeTransparentInstances=String(transparentTotal);canvas.dataset.threeAdditiveInstances=String(additiveTotal);canvas.dataset.threeDroppedInstances=String(dropped);
      }

      // Local post stack: HDR scene target -> threshold -> separable blur -> ACES composite.
      const targetOptions={type:THREE.HalfFloatType,format:THREE.RGBAFormat,depthBuffer:true,stencilBuffer:false},sceneTarget=new THREE.WebGLRenderTarget(2,2,targetOptions),bloomA=new THREE.WebGLRenderTarget(2,2,{...targetOptions,depthBuffer:false}),bloomB=new THREE.WebGLRenderTarget(2,2,{...targetOptions,depthBuffer:false});sceneTarget.texture.colorSpace=THREE.LinearSRGBColorSpace;bloomA.texture.colorSpace=THREE.LinearSRGBColorSpace;bloomB.texture.colorSpace=THREE.LinearSRGBColorSpace;
      const postScene=new THREE.Scene(),postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),postQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));postQuad.frustumCulled=false;postScene.add(postQuad);
      const fullscreenVertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
      const brightMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{tInput:{value:sceneTarget.texture},threshold:{value:.65},knee:{value:.24}},vertexShader:fullscreenVertex,fragmentShader:'uniform sampler2D tInput;uniform float threshold;uniform float knee;varying vec2 vUv;void main(){vec3 c=texture2D(tInput,vUv).rgb;float b=max(c.r,max(c.g,c.b));float soft=clamp((b-threshold+knee)/(2.0*knee),0.0,1.0);soft=soft*soft*(3.0-2.0*soft);float contribution=max(b-threshold,0.0)+soft*knee;gl_FragColor=vec4(c*contribution/max(b,.0001),1.0);}'});
      const blurMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{tInput:{value:bloomA.texture},direction:{value:new THREE.Vector2(1,0)},texel:{value:new THREE.Vector2(.001,.001)}},vertexShader:fullscreenVertex,fragmentShader:'uniform sampler2D tInput;uniform vec2 direction;uniform vec2 texel;varying vec2 vUv;void main(){vec2 o=direction*texel;vec3 c=texture2D(tInput,vUv).rgb*.227027;c+=texture2D(tInput,vUv+o*1.384615).rgb*.316216;c+=texture2D(tInput,vUv-o*1.384615).rgb*.316216;c+=texture2D(tInput,vUv+o*3.230769).rgb*.070270;c+=texture2D(tInput,vUv-o*3.230769).rgb*.070270;gl_FragColor=vec4(c,1.0);}'});
      const compositeMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{tScene:{value:sceneTarget.texture},tBloom:{value:bloomA.texture},bloomStrength:{value:.58},exposure:{value:1},vignette:{value:.16},saturation:{value:1.06},chromatic:{value:.25},grain:{value:.012},time:{value:0}},vertexShader:fullscreenVertex,fragmentShader:'uniform sampler2D tScene;uniform sampler2D tBloom;uniform float bloomStrength;uniform float exposure;uniform float vignette;uniform float saturation;uniform float chromatic;uniform float grain;uniform float time;varying vec2 vUv;vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}void main(){vec2 split=(vUv-.5)*.0026*chromatic;vec3 sceneColor=vec3(texture2D(tScene,vUv+split).r,texture2D(tScene,vUv).g,texture2D(tScene,vUv-split).b);vec3 c=sceneColor+texture2D(tBloom,vUv).rgb*bloomStrength;float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,saturation);c=aces(c*exposure);float d=dot(vUv-.5,vUv-.5);c*=1.0-vignette*smoothstep(.06,.54,d);c+=(hash(vUv*vec2(1733.0,947.0)+time)-.5)*grain;gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}'});
      let postWidth=0,postHeight=0,postScale=0;
      function resizePost(rtx){const scale=rtx?.5:.25,w=Math.max(2,canvas.width),h=Math.max(2,canvas.height),bw=Math.max(2,Math.floor(w*scale)),bh=Math.max(2,Math.floor(h*scale));if(w!==postWidth||h!==postHeight){sceneTarget.setSize(w,h);postWidth=w;postHeight=h;}if(scale!==postScale||bloomA.width!==bw||bloomA.height!==bh){bloomA.setSize(bw,bh);bloomB.setSize(bw,bh);postScale=scale;}blurMaterial.uniforms.texel.value.set(1/bw,1/bh);}
      function renderPost(rtx,time){
        resizePost(rtx);renderer.setRenderTarget(sceneTarget);renderer.clear();renderer.render(scene,camera);
        brightMaterial.uniforms.threshold.value=rtx?.50:.64;brightMaterial.uniforms.knee.value=rtx?.3:.22;postQuad.material=brightMaterial;renderer.setRenderTarget(bloomA);renderer.clear();renderer.render(postScene,postCamera);
        const passes=rtx?2:1;for(let pass=0;pass<passes;pass++){blurMaterial.uniforms.tInput.value=bloomA.texture;blurMaterial.uniforms.direction.value.set(1,0);postQuad.material=blurMaterial;renderer.setRenderTarget(bloomB);renderer.clear();renderer.render(postScene,postCamera);blurMaterial.uniforms.tInput.value=bloomB.texture;blurMaterial.uniforms.direction.value.set(0,1);renderer.setRenderTarget(bloomA);renderer.clear();renderer.render(postScene,postCamera);}
        compositeMaterial.uniforms.bloomStrength.value=(rtx?.43:.34)*FX_GLOW_SCALE;compositeMaterial.uniforms.exposure.value=rtx?1.12:1.01;compositeMaterial.uniforms.vignette.value=rtx?.18:.11;compositeMaterial.uniforms.saturation.value=rtx?1.08:1.035;compositeMaterial.uniforms.chromatic.value=rtx?.34:.1;compositeMaterial.uniforms.grain.value=rtx?.01:.005;compositeMaterial.uniforms.time.value=time*.001;postQuad.material=compositeMaterial;renderer.setRenderTarget(null);renderer.clear();renderer.render(postScene,postCamera);
      }

      let floorKey='',themeKey='',lastThemeUpdate=-Infinity,lastRenderQuality='';
      function updateFloor(focus,theme,time){
        const gx=Math.floor(focus.x/4),gz=Math.floor(focus.z/4),nextFloorKey=`${gx}:${gz}`,placementChanged=nextFloorKey!==floorKey;
        if(placementChanged){let index=0;for(let x=-10;x<=10;x++)for(let z=-9;z<=9;z++){matrixDummy.position.set((gx+x)*4,-.28,(gz+z)*4);matrixDummy.scale.set(1,1,1);matrixDummy.rotation.set(0,0,0);matrixDummy.updateMatrix();floor.setMatrixAt(index++,matrixDummy.matrix);}floor.instanceMatrix.needsUpdate=true;floorKey=nextFloorKey;grid.position.x=gx*4;grid.position.z=gz*4;}
        const nextThemeKey=[...theme.ground,...theme.groundAlt,...theme.accent,...theme.secondary].map(value=>value.toFixed(3)).join(':');
        if((placementChanged||nextThemeKey!==themeKey)&&(placementChanged||time-lastThemeUpdate>70)){let index=0;for(let x=-10;x<=10;x++)for(let z=-9;z<=9;z++){const shade=((gx+x)+(gz+z))%2===0?theme.ground:theme.groundAlt;scratchColor.setRGB(shade[0]*2.15,shade[1]*2.15,shade[2]*2.15);floor.setColorAt(index++,scratchColor);}floor.instanceColor.needsUpdate=true;themeKey=nextThemeKey;lastThemeUpdate=time;}
      }
      function updatePylons(theme,time){
        for(let i=0;i<18;i++){const{angle,x,z,height}=arenaPylonPlacement(i);matrixDummy.position.set(x,height*.38,z);matrixDummy.scale.set(.8,height*.75,.8);matrixDummy.rotation.set(0,angle,0);matrixDummy.updateMatrix();pylonBases.setMatrixAt(i,matrixDummy.matrix);matrixDummy.position.set(x,height*1.18+Math.sin(time*.001+i)*.08,z);matrixDummy.scale.set(.48,.82,.48);matrixDummy.rotation.set(time*.0007+i,angle,-time*.00045);matrixDummy.updateMatrix();pylonCrystals.setMatrixAt(i,matrixDummy.matrix);}
        pylonBases.instanceMatrix.needsUpdate=true;pylonCrystals.instanceMatrix.needsUpdate=true;pylonMaterial.color.setRGB(theme.groundAlt[0]*2.6,theme.groundAlt[1]*2.6,theme.groundAlt[2]*2.6);pylonMaterial.emissive.setRGB(theme.accent[0]*.12,theme.accent[1]*.12,theme.accent[2]*.12);crystalMaterial.color.setRGB(theme.accent[0]*1.3,theme.accent[1]*1.3,theme.accent[2]*1.3);crystalMaterial.emissive.setRGB(theme.accent[0]*2.1,theme.accent[1]*2.1,theme.accent[2]*2.1);
      }
      function updateArenaEffects(focus,theme,time,rtx,visible){
        const dustAttribute=dustGeometry.attributes.position,dustSpan=92,dustHalf=dustSpan*.5;for(let i=0;i<dustCount;i++){dustPositions[i*3]=focus.x+(((dustWorldX[i]-focus.x+dustHalf)%dustSpan+dustSpan)%dustSpan)-dustHalf;dustPositions[i*3+1]=.35+((((i*31)%100)/100*14)+time*.00016*dustSpeeds[i])%14;dustPositions[i*3+2]=focus.z+(((dustWorldZ[i]-focus.z+dustHalf)%dustSpan+dustSpan)%dustSpan)-dustHalf;}dustAttribute.needsUpdate=true;riftDust.position.set(0,0,0);riftDust.rotation.set(0,0,0);dustMaterial.color.setRGB(theme.accent[0]*1.65,theme.accent[1]*1.65,theme.accent[2]*1.65);dustMaterial.opacity=rtx?.32:.16;dustMaterial.size=rtx?.11:.065;
        const lightSources=[],zoneLights=visible?.zones||zones,projectileLights=visible?.projectiles||projectiles,enemyProjectileLights=visible?.enemyProjectiles||enemyProjectiles;for(const z of zoneLights){if((z.x-focus.x)**2+(z.z-focus.z)**2<24**2)lightSources.push({x:z.x,y:.7,z:z.z,color:z.color||COLORS.violet,hostile:String(z.kind).startsWith('enemy'),power:z.kind==='blast'||z.kind==='enemyBlast'?1.45:1});}for(const p of projectileLights){if((p.x-focus.x)**2+(p.z-focus.z)**2<20**2)lightSources.push({x:p.x,y:p.y||.7,z:p.z,color:p.color||COLORS.cyan,hostile:false,power:.72});}for(const p of enemyProjectileLights){if((p.x-focus.x)**2+(p.z-focus.z)**2<22**2)lightSources.push({x:p.x,y:p.y||.8,z:p.z,color:COLORS.red,hostile:true,power:.9});}lightSources.sort((a,b)=>(a.x-focus.x)**2+(a.z-focus.z)**2-((b.x-focus.x)**2+(b.z-focus.z)**2));
        for(let i=0;i<effectLights.length;i++){const light=effectLights[i],source=lightSources[i];if(!source){light.visible=false;continue;}const raw=source.color,playerRed=!source.hostile&&raw[0]>(raw[1]*1.8)&&raw[0]>(raw[2]*1.35),color=source.hostile?COLORS.red:playerRed?COLORS.amber:raw;light.visible=true;light.position.set(source.x,source.y+1.1,source.z);light.color.setRGB(color[0]*1.35,color[1]*1.35,color[2]*1.35);light.intensity=(rtx?46:24)*FX_GLOW_SCALE*source.power*(.9+Math.sin(time*.009+i)*.1);light.distance=rtx?9:7;}
        grid.material.opacity=rtx?.36:.24;
      }
      function renderArena({time,eye,lookTarget,fov,focus,theme,rtx,batches:sourceBatches,weaponFx,pocketVisual,monsterVisuals}){
        const quality=rtx?'rtx':'normal';if(quality!==lastRenderQuality){renderer.shadowMap.enabled=rtx;sun.castShadow=rtx;renderer.shadowMap.needsUpdate=true;for(const material of [floorMaterial,pylonMaterial,crystalMaterial,dustMaterial])material.needsUpdate=true;for(const group of Object.values(instanceGroups))for(const mesh of [group.opaque,group.transparent,group.additive])mesh.material.needsUpdate=true;lastRenderQuality=quality;}
        updateFloor(focus,theme,time);updatePylons(theme,time);updateArenaEffects(focus,theme,time,rtx,weaponFx);camera.position.set(eye[0],eye[1],eye[2]);camera.up.set(0,1,0);camera.lookAt(lookTarget[0],lookTarget[1],lookTarget[2]);camera.fov=THREE.MathUtils.radToDeg(fov);camera.aspect=canvas.width/Math.max(1,canvas.height);camera.near=.1;camera.far=110;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
        renderer.shadowMap.enabled=rtx;sun.castShadow=rtx;renderer.toneMappingExposure=1;hemisphere.intensity=rtx?.48:1.22;ambient.intensity=rtx?.045:.31;sun.intensity=rtx?4.1:2.28;playerLight.intensity=rtx?116:70;sideLightA.intensity=rtx?68:36;sideLightB.intensity=rtx?60:32;floorMaterial.roughness=rtx?.46:.78;floorMaterial.metalness=rtx?.56:.2;sun.shadow.radius=rtx?5:1;sun.shadow.blurSamples=rtx?12:4;
        clearColor.setRGB(theme.fog[0]*(rtx?.72:1.05),theme.fog[1]*(rtx?.72:1.05),theme.fog[2]*(rtx?.72:1.05));scene.fog.color.copy(clearColor);scene.fog.density=rtx?.0105:.013;renderer.setClearColor(clearColor,1);hemisphere.color.setRGB(Math.min(1,theme.accent[0]*1.5+.18),Math.min(1,theme.accent[1]*1.5+.18),Math.min(1,theme.accent[2]*1.5+.18));hemisphere.groundColor.setRGB(theme.fog[0],theme.fog[1],theme.fog[2]);
        sun.position.set(focus.x-20,30,focus.z+16);sunTarget.position.set(focus.x,0,focus.z);sunTarget.updateMatrixWorld();playerLight.color.setRGB(Math.min(1,theme.accent[0]*1.8+.18),Math.min(1,theme.accent[1]*1.8+.18),Math.min(1,theme.accent[2]*1.8+.18));playerLight.position.set(focus.x,4.2,focus.z);sideLightA.color.setRGB(theme.secondary[0],theme.secondary[1],theme.secondary[2]);sideLightA.position.set(focus.x+12,3.2,focus.z-9);sideLightB.color.setRGB(theme.accent[0],theme.accent[1],theme.accent[2]);sideLightB.position.set(focus.x-11,2.8,focus.z+10);grid.material.color.setRGB(theme.accent[0]*1.4,theme.accent[1]*1.4,theme.accent[2]*1.4);
        updatePocketModel(pocketVisual,time);updateMonsterModels(monsterVisuals,time);syncInstanceBatches(sourceBatches);updateWeaponFx(time,rtx,weaponFx);renderer.setViewport(0,0,canvas.width,canvas.height);renderer.resetState();renderPost(rtx,time);canvas.dataset.threeArena='active';canvas.dataset.threeRenderer='active';canvas.dataset.threeVersion=THREE.REVISION;canvas.dataset.threeQuality=rtx?'rtx':'normal';canvas.dataset.threeShadows=rtx?'vsm-512':'off';canvas.dataset.threePost=rtx?'hdr-bloom-high':'hdr-bloom-low';canvas.dataset.threeWeaponFx='shader-instanced';canvas.dataset.threeParticles='world-space';canvas.dataset.threeEffectLights=String(effectLights.filter(light=>light.visible).length);canvas.dataset.threeGlow='70-percent';
      }
      threeArenaRenderer={render:renderArena,revision:THREE.REVISION,hasPocketModel:()=>pocketLoadState==='ready',hasMonsterModel:()=>monsterLoadState==='ready'};return threeArenaRenderer;
    }catch(error){console.warn('Three.js renderer disabled:',error);canvas.dataset.threeArena='error';canvas.dataset.threeRenderer='error';canvas.dataset.threeError=String(error?.message||error);threeArenaRenderer=false;return null;}
  }
  const THREAT_NAMES=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV','XXVI','XXVII','XXVIII','XXIX','XXX'];
  const threatLabel=tier=>THREAT_NAMES[tier]||`Ω-${Math.max(1,tier-29)}`;
  const HEROES = {
    vanguard:{name:'ВАНГАРД',color:COLORS.cyan,maxHp:130,speed:7.2,armor:15,damage:1,crit:.05,pierce:2,starter:'blaster'},
    witch:{name:'ВЕДЬМА',color:COLORS.violet,maxHp:82,speed:7,armor:0,damage:1.35,crit:.08,pierce:1,starter:'blaster'},
    runner:{name:'РАННЕР',color:COLORS.amber,maxHp:105,speed:8.8,armor:5,damage:1,crit:.15,pierce:1,starter:'blaster'},
    engineer:{name:'ИНЖЕНЕР',color:COLORS.amber,maxHp:110,speed:6.8,armor:12,damage:.85,crit:.05,pierce:1,duration:1.25,starter:'drone'},
    pyromancer:{name:'ПИРОМАНТ',color:COLORS.red,maxHp:96,speed:7.1,armor:3,damage:1.08,crit:.06,pierce:1,starter:'firetrail'},
    necromancer:{name:'НЕКРОМАНТ',color:COLORS.violet,maxHp:92,speed:6.9,armor:4,damage:.95,crit:.06,pierce:1,starter:'nanoswarm'},
    duelist:{name:'ДУЭЛЯНТ',color:COLORS.white,maxHp:104,speed:7.6,armor:6,damage:1,crit:.12,pierce:1,starter:'boomerang'},
    chronomancer:{name:'ХРОНОМАНТ',color:COLORS.cyan,maxHp:94,speed:7.2,armor:4,damage:.85,crit:.08,pierce:1,starter:'chrononeedles'},
    berserker:{name:'БЕРСЕРК',color:COLORS.red,maxHp:145,speed:7.4,armor:0,damage:1,crit:.08,pierce:1,starter:'saw'},
    guardian:{name:'СТРАЖ',color:COLORS.cyan,maxHp:165,speed:6.1,armor:28,damage:.9,crit:.04,pierce:1,starter:'aura'},
    voidwalker:{name:'ПУСТОТНИК',color:COLORS.violet,maxHp:102,speed:7,armor:8,damage:1,crit:.06,pierce:1,projSpeed:.75,starter:'gravity'},
    gambler:{name:'АЗАРТНИК',color:COLORS.amber,maxHp:100,speed:7.4,armor:5,damage:1,crit:.1,pierce:1,randomStarter:true},
    cursed:{name:'ПРОКЛЯТЫЙ',color:COLORS.pink,maxHp:112,speed:7.2,armor:8,damage:1.08,crit:.08,pierce:1,starter:'blaster'},
    riftwalker:{name:'СКИТАЛЕЦ РАЗЛОМА',color:COLORS.green,maxHp:106,speed:7.5,armor:8,damage:1,crit:.08,pierce:1,starter:'riftlance'},
    mimic:{name:'МИМИК',color:COLORS.white,maxHp:118,speed:7.2,armor:10,damage:1,crit:.08,pierce:1,weaponSlots:4}
  };
  const HERO_BASE_DAMAGE_MULTIPLIER=1.15;
  const CODEX_HEROES = {
    vanguard:{icon:'◆',color:'#38f3ff',role:'СБАЛАНСИРОВАННЫЙ',summary:'Надёжный герой без ситуационных условий. Выдерживает ошибки и с самого начала прошивает дополнительную цель.',abilities:[['Усиленная база','130 HP, 15 брони и базовое пробитие 2 делают Вангарда самым ровным стартовым героем.'],['Без скрытых условий','У Вангарда нет отдельной активной способности или штрафа: все указанные характеристики работают постоянно.']],tags:['Выживаемость','Пробитие','Простой старт']},
    witch:{icon:'✦',color:'#a56cff',role:'СТЕКЛЯННАЯ ПУШКА',summary:'Сразу получает высокий множитель урона, расплачиваясь самым маленьким запасом здоровья и отсутствием брони.',abilities:[['Запретная мощь','Глобальный базовый урон ×1,35 применяется ко всему оружию и большинству атакующих эффектов.'],['Хрупкость','Только 82 HP и 0 брони. Отдельной защиты или аварийной способности у Ведьмы нет.']],tags:['Высокий урон','Низкое HP','Риск']},
    runner:{icon:'➤',color:'#ffbd3d',role:'СКОРОСТЬ И КРИТ',summary:'Мобильный герой с высокой стартовой скоростью и критическим шансом, удобный для постоянного кайтинга.',abilities:[['Фора в движении','Стартовая скорость 8,8 — одна из самых высоких среди героев.'],['Точный темп','15% базового шанса критического удара вместо стандартных 5–8%. Отдельных условных пассивов нет.']],tags:['Скорость','Криты','Кайтинг']},
    engineer:{icon:'⬡',color:'#ffbd3d',role:'ТЕХНИКА И ЗОНЫ',summary:'Усиливает автономное оружие, поддерживает дополнительный дрон и регулярно разворачивает временные турели.',abilities:[['Дополнительный дрон','Дроны-охотники всегда получают +1 дрон сверх количества от уровня оружия.'],['Автотурель','Первая турель появляется через 5 секунд, следующие — каждые 20 секунд. Турель существует 34 секунды; одновременно может быть не больше 2.'],['Огонь турели','Турель стреляет каждые 0,52 секунды. Базовый урон выстрела: 9 + 0,28 × уровень героя; урон дополнительно масштабируется глобальными бонусами.'],['Инженерный ресурс','Длительность всех подходящих атак, зон и временных эффектов изначально умножена на 1,25.']],tags:['Призывы','Автоматизация','Длительность']},
    pyromancer:{icon:'♨',color:'#ff3f68',role:'ЦЕПНОЕ ГОРЕНИЕ',summary:'Разгоняет огненный урон повторными попаданиями и превращает горящих врагов в цепочку взрывов.',abilities:[['Заряды огня','Каждое огненное попадание добавляет конкретному врагу 1 заряд, максимум 5. Каждый заряд после первого даёт +12% огненного урона: на 5 зарядах бонус составляет +48%.'],['Сброс зарядов','Если враг около 1,1 секунды не получает огненный урон, его заряды полностью исчезают. У каждого врага свой счётчик.'],['Цепное воспламенение','Убийство горящего врага с вероятностью 30% создаёт взрыв радиусом 3. Базовый урон: 18 + 0,25 × уровень героя. Взрывы не запускают новые взрывы напрямую.'],['Узкая специализация','Любой неогненный урон Пироманта умножается на 0,8. Огненными считаются Огненный след, огонь от трупов и взрыв Пироманта.']],tags:['Огонь','Стаки','Цепные взрывы']},
    necromancer:{icon:'☠',color:'#a56cff',role:'АРМИЯ МЕРТВЕЦОВ',summary:'Превращает накопленные убийства в самостоятельных прислужников, которые преследуют ближайшие цели.',abilities:[['Подъём мертвеца','Каждые 35 общих убийств появляется один прислужник в месте смерти врага.'],['Предел армии','Прислужник существует 30 секунд; одновременно разрешено не больше 8 прислужников. Старые исчезают при превышении лимита.'],['Атака прислужника','Базовый урон удара: 7 + 0,28 × уровень героя. Интервал атаки — 0,68 секунды; скорость преследования — 5,2. Урон получает глобальные модификаторы героя.']],tags:['Призывы','Убийства','Масштабирование от уровня']},
    duelist:{icon:'⌖',color:'#dcefff',role:'РУЧНОЙ ФОКУС',summary:'Максимально раскрывается при ручном захвате опасной цели и получает короткую награду за завершённую дуэль.',abilities:[['Условия дуэли','Весь урон по цели, захваченной ЛКМ, умножается на 1,35. Пока цель не захвачена, весь исходящий урон умножается на 0,9.'],['Награда за убийство','Убийство захваченной цели даёт на 5 секунд ×1,25 скорости движения и +25 процентных пунктов к шансу крита.'],['Возврат в авторежим','После смерти захваченной цели прицел автоматически возвращается к обычному выбору целей. ПКМ отменяет захват вручную.']],tags:['Захват цели','Боссы','Криты']},
    chronomancer:{icon:'⌛',color:'#38f3ff',role:'КОНТРОЛЬ ВРЕМЕНИ',summary:'Периодически останавливает наступающую толпу и ускоряет собственные атаки рядом с замедленными врагами.',abilities:[['Хроносфера','Первая сфера срабатывает через 8 секунд, следующие — каждые 30 секунд. Радиус 9; обычные враги получают замедление 65% на 4 секунды.'],['Сопротивление боссов','Боссы и мини-боссы ослабляют любой контроль, поэтому фактический эффект Хроносферы на них заметно меньше.'],['Темп против замедленных','Если в радиусе 14 находится хотя бы один замедленный враг, итоговый темп атак умножается на 1,18.']],tags:['Замедление','Контроль толпы','Темп атак']},
    berserker:{icon:'✺',color:'#ff3f68',role:'СИЛА ЧЕРЕЗ БОЛЬ',summary:'Становится опаснее с потерей здоровья, но сам получает больше урона и вынужден сражаться на грани.',abilities:[['Ярость','За каждые полные 10% недостающего здоровья исходящий урон повышается на 6%, вплоть до +60%.'],['Безумный темп','Темп атак растёт плавно с потерей здоровья и достигает +40% около нулевого HP.'],['Кровавое восстановление','Ниже 50% HP каждое нанесение урона лечит на min(0,65; нанесённый урон × 0,0015).'],['Открытая защита','Весь входящий сырой урон умножается на 1,15 до применения брони.']],tags:['Низкое HP','Урон','Самолечение']},
    guardian:{icon:'⬣',color:'#38f3ff',role:'ЩИТ И КОНТРВОЛНА',summary:'Самый стойкий герой: полностью поглощает отдельные попадания, имеет уменьшенные хитбоксы и отвечает контрволной.',abilities:[['Два щита','Начинает с 2 зарядами. Каждый заряд полностью поглощает одно попадание и восстанавливается отдельно через 8 секунд.'],['Контрволна','Когда ломается последний заряд, наносит всем врагам в радиусе 5,2 базовый урон 22 + 0,30 × уровень героя.'],['Уменьшенный хитбокс','Радиус попадания вражеских снарядов уменьшен с 0,58 до 0,44; добавка к дистанции вражеской ближней атаки — с 0,42 до 0,30.'],['Цена защиты','Высокие 165 HP и 28 брони компенсируются скоростью 6,1 и глобальным уроном ×0,9.']],tags:['Щиты','Броня','Малый хитбокс']},
    voidwalker:{icon:'●',color:'#a56cff',role:'ВЛАСТЕЛИН ЗОН',summary:'Собирает врагов Гравитационным колодцем, разрывает их уникальным Давлением пустоты и ускоряет следующий колодец убийствами.',abilities:[['Давление пустоты','Только у Пустотника его собственный колодец наносит урон раз в 0,45 секунды. Базовый урон тика: 4 + 1,5 × уровень Гравитационного колодца; эволюция умножает его на 1,35.'],['Власть гравитации','Весь урон по врагу, находящемуся внутри собственного Гравитационного колодца, умножается на 1,25. Этот бонус усиливает и Давление пустоты.'],['Коллапс','Каждое убийство внутри собственного колодца немедленно сокращает текущую перезарядку Гравитационного колодца на 0,32 секунды.'],['Тяжёлые снаряды','Глобальная скорость снарядов изначально умножена на 0,75. Для всех остальных героев Гравитационный колодец по-прежнему наносит 0 урона.']],tags:['Притягивание','Урон по площади','Сокращение перезарядки']},
    gambler:{icon:'◆',color:'#ffbd3d',role:'СЛУЧАЙНЫЙ ЗАБЕГ',summary:'Получает случайное стартовое оружие, чаще видит высокие редкости и раз в восемь уровней принимает бонус вместе с проклятием.',abilities:[['Случайный арсенал','Начинает с одним случайным оружием из всего доступного списка. Сохранение улучшения отключено: 0 удержаний вместо 2.'],['Смещённые редкости','Вес обычных улучшений ×0,55, редких ×1,15, эпических ×1,65, легендарных ×2,2. Это влияет на вес выбора, а не гарантирует редкость.'],['Бросок каждые 8 уровней','Получает один случайный бонус: +12% базового урона, ×1,10 темпа атак, +8 процентных пунктов крита или +1 снаряд. Максимум 12 бросков за забег.'],['Обязательное проклятие','Одновременно получает один штраф: −6% максимального HP, −6 брони, ×0,95 скорости или ×0,85 радиуса сбора. HP не опускается ниже 20; броня — ниже −20.']],tags:['Случайность','Редкость','Бонус и проклятие']},
    cursed:{icon:'♛',color:'#ff4fa3',role:'РЕЛИКВИЯ ЗА РИСК',summary:'Начинает забег с уникальной босс-реликвией, но навсегда усиливает противников и играет с расширенным выбором награды босса.',abilities:[['Похищенная реликвия','В начале забега получает одну случайную доступную босс-реликвию. Она имеет один ранг и не занимает обычный слот предмета.'],['Проклятие мира','Множитель здоровья всех врагов повышается ещё на 30%, а их урон — ещё на 15% поверх выбранной сложности.'],['Расширенная награда','После победы над боссом выбирает одну реликвию из 4 вариантов вместо стандартных 3. Обычное повышение уровня по-прежнему показывает 3 варианта.']],tags:['Босс-реликвии','Высокий риск','Усиленные враги']},
    riftwalker:{icon:'╾',color:'#63ff9a',role:'МАСТЕР ГЕОМЕТРИИ',summary:'Использует окружение или набранную инерцию, чтобы одновременно ускориться, повысить урон и гарантировать критические удары.',abilities:[['Резонанс с препятствием','На карте с препятствиями пассив включается рядом с геометрией уровня. Пока она активна: ×1,18 урона, ×1,12 скорости и гарантированный крит для атак, способных критовать.'],['Обычная карта','Если препятствий нет, пассив включается во время движения после заполнения инерции выше 80%. Полный заряд набирается примерно за 1,2 секунды непрерывного движения.'],['Потеря инерции','После остановки заряд постепенно исчезает примерно за 1,5 секунды; бонус отключается ниже порога активации.']],tags:['Препятствия','Движение','Гарантированный крит']},
    mimic:{icon:'◈',color:'#dcefff',role:'КРАЖА АТАК',summary:'Не имеет обычного стартового оружия, зато постоянно использует встроенную автоатаку и периодически копирует опасных противников.',abilities:[['Эхо Мимика','Встроенная автоатака не занимает слот. Дальность 27, базовый урон 13 + 0,32 × уровень героя, перезарядка 0,82 / темп атак секунды; параметр снарядов увеличивает залп до 6.'],['Поиск образца','Первая попытка копирования происходит через 5 секунд, следующие — каждые 11 секунд. Целью может быть элита, мини-босс или босс в радиусе 30 и на прямой линии огня.'],['Украденная атака','По элите выпускает 3 + бонус снарядов, по мини-боссу или боссу — 6 + бонус снарядов. Базовый урон каждого: 22 + 0,45 × уровень героя; приоритет отдаётся боссам и мини-боссам.'],['Ограниченный арсенал','Доступно только 4 слота обычного оружия вместо 5. Если подходящей цели для копирования нет, одиннадцатисекундная перезарядка всё равно начинается заново.']],tags:['Встроенная атака','Элиты и боссы','Снаряды','4 слота оружия']}
  };
  const WEAPON_INFO = {
    blaster:{name:'Осколочный залп',icon:'✦',color:'cyan'},
    aura:{name:'Нулевая аура',icon:'◉',color:'violet'},
    orbit:{name:'Орбитальные клинки',icon:'⟲',color:'amber'},
    lightning:{name:'Цепь молний',icon:'ϟ',color:'cyan'},
    meteor:{name:'Метеоритный дождь',icon:'☄',color:'amber'},
    saw:{name:'Пила разрыва',icon:'✺',color:'green'},
    frost:{name:'Крио-импульс',icon:'❄',color:'cyan'},
    drone:{name:'Дроны-охотники',icon:'⬡',color:'amber'},
    gravity:{name:'Гравитационный колодец',icon:'●',color:'violet'},
    firetrail:{name:'Огненный след',icon:'♨',color:'cyan'},
    riftlance:{name:'Копьё Разлома',icon:'╾',color:'cyan'},
    boomerang:{name:'Призрачный бумеранг',icon:'☾',color:'violet'},
    prism:{name:'Кристальный призматор',icon:'◈',color:'cyan'},
    mines:{name:'Минный фабрикатор',icon:'⊙',color:'amber'},
    mortar:{name:'Ионный миномёт',icon:'◒',color:'amber'},
    chrononeedles:{name:'Хроно-иглы',icon:'⇶',color:'cyan'},
    seismic:{name:'Сейсмическое ядро',icon:'◎',color:'green'},
    nanoswarm:{name:'Нанорой',icon:'⁙',color:'green'},
    mirrordisc:{name:'Зеркальный диск',icon:'◐',color:'white'},
    resonance:{name:'Резонансный колокол',icon:'♢',color:'violet'}
  };
  const CODEX_WEAPONS = {
    blaster:{summary:'Автонаводящийся залп в ближайшую цель. Надёжное основное оружие с ростом числа снарядов и пробития.',stats:[['Урон','11 + 4 × L'],['Перезарядка','0,72 / (темп × (1 + 0,055 × L)) сек'],['Снаряды','бонус героя + ⌊L / 4⌋'],['Пробитие','бонус героя + ⌊L / 3⌋'],['Калибр','0,24 + 0,015 × L'],['Скорость','15 + 0,7 × L']],impacts:['Урон героя','Темп атак','Снаряды','Пробитие','Калибр','Скорость снарядов']},
    aura:{summary:'Периодический взрыв вокруг героя. Не требует цели и особенно силён против окружившей толпы.',stats:[['Урон','9 + 6 × L'],['Перезарядка','(1,70 − 0,07 × L) / темп сек'],['Радиус','3,10 + 0,48 × L'],['Тип','Зона вокруг героя']],impacts:['Урон героя','Темп атак','Размер атак']},
    orbit:{summary:'Клинки постоянно вращаются вокруг героя и повторно задевают проходящих через орбиту врагов.',stats:[['Урон касания','7 + 3,2 × L'],['Клинки','2 + ⌊L / 2⌋'],['Радиус орбиты','2,15 + 0,12 × L'],['Интервал по цели','0,18 сек']],impacts:['Урон героя','Размер атак','Длительность эффектов']},
    lightning:{summary:'Молния перескакивает между ближайшими целями. Дополнительные снаряды создают новые начальные дуги с 55% урона.',stats:[['Урон','18 + 8 × L'],['Начальные дуги','1 + бонус снарядов'],['Урон дополнительных дуг','55%'],['Цели каждой цепи','2 + L + 2 × бонус цепи'],['Дальность прыжка','5,50 + 0,25 × L'],['Перезарядка','(2,50 − 0,11 × L) / темп сек']],impacts:['Урон героя','Темп атак','Снаряды','Цепь молний']},
    meteor:{summary:'Выбирает самые плотные скопления и обрушивает на них метеоры с большим уроном по площади. Дополнительные метеоры от параметра снарядов наносят 50% урона.',stats:[['Урон','28 + 12 × L'],['Основные метеоры','min(1 + ⌊L / 3⌋, 5)'],['Дополнительные метеоры','бонус снарядов · 50% урона'],['Радиус','2,20 + 0,28 × L'],['Перезарядка','(4,20 − 0,18 × L) / темп сек']],impacts:['Урон героя','Темп атак','Снаряды','Размер атак','Урон по площади']},
    saw:{summary:'Медленные пилы проходят сквозь длинные колонны врагов и существуют ограниченное время.',stats:[['Урон','24 + 9 × L'],['Пилы','1 + ⌊L / 4⌋ + бонус снарядов'],['Пробитие','7 + 2 × L + бонус героя'],['Длительность','2,80 + 0,12 × L сек'],['Калибр','0,52 + 0,045 × L'],['Перезарядка','(2,30 − 0,08 × L) / темп сек']],impacts:['Урон героя','Темп атак','Снаряды','Пробитие','Калибр','Скорость снарядов','Длительность']},
    frost:{summary:'Круговой импульс наносит урон и надолго замедляет всех задетых противников.',stats:[['Урон','12 + 6 × L'],['Радиус','4,00 + 0,48 × L'],['Замедление','min(42% + 3,5% × L, 72%)'],['Длительность','2,00 + 0,35 × L сек'],['Перезарядка','(3,40 − 0,12 × L) / темп сек']],impacts:['Урон героя','Темп атак','Размер атак','Длительность','Урон по замедленным']},
    drone:{summary:'Автономные дроны сопровождают героя и самостоятельно расстреливают ближайшие цели.',stats:[['Урон пули','8 + 3,5 × L'],['Дроны','1 + ⌊L / 3⌋'],['Пробитие','1 + ⌊L / 4⌋'],['Темп дрона','0,78 − 0,035 × L сек'],['Скорость пули','19']],impacts:['Урон героя','Темп атак','Снаряды','Пробитие','Калибр']},
    gravity:{summary:'Создаёт поле притяжения для контроля и сборки толпы. Обычно не наносит урон; Пустотник добавляет собственное Давление пустоты.',stats:[['Урон','0 · Пустотник: 4 + 1,5 × L каждые 0,45 сек'],['Радиус','3,20 + 0,35 × L'],['Длительность','2,50 + 0,30 × L сек'],['Сила притяжения','3,50 + 0,70 × L'],['Перезарядка','2 × (6,00 − 0,22 × L) / темп сек'],['Боссы','15% обычного притяжения']],impacts:['Темп атак','Размер атак','Длительность','Контроль толпы','Пассив Пустотника']},
    firetrail:{summary:'Во время движения оставляет за героем горящие зоны. Урон каждой зоны срабатывает периодически.',stats:[['Урон тика','5 + 2,8 × L'],['Интервал тика','0,30 сек'],['Радиус','1,05 + 0,10 × L'],['Длительность','2,20 + 0,28 × L сек'],['Шаг создания','0,48 − 0,025 × L сек']],impacts:['Урон героя','Огненный урон','Темп зон','Размер атак','Длительность']},
    riftlance:{summary:'Длинный луч насквозь прошивает линию врагов перед героем. Дополнительные лучи наносят 50% урона и не дублируют зоны эволюции.',stats:[['Урон','32 + 7 × (L − 1)'],['Лучей','1 + бонус снарядов'],['Урон дополнительных лучей','50%'],['Длина','30 + 0,70 × L'],['Ширина','0,34 + 0,035 × L'],['Лимит целей','8 + (L − 1) + пробитие'],['Перезарядка','(1,60 − 0,045 × L) / темп сек']],impacts:['Урон героя','Темп атак','Снаряды','Пробитие','Калибр']},
    boomerang:{summary:'Серп летит вперёд, а затем возвращается к герою и наносит повышенный обратный урон.',stats:[['Урон туда','18 + 4 × (L − 1)'],['Урон обратно','24 + 5 × (L − 1)'],['Серпы','1 + бонус снарядов'],['Пробитие','4 + L + бонус героя'],['Длительность','2,45 + 0,07 × L сек'],['Скорость','10 + 0,42 × L'],['Перезарядка','(1,30 − 0,035 × L) / темп сек']],impacts:['Урон героя','Темп атак','Снаряды','Пробитие','Калибр','Скорость снарядов','Длительность']},
    prism:{summary:'Непрерывный луч удерживает одну цель и постепенно разгоняет наносимый ей урон. Дополнительные снаряды создают боковые лучи по соседним целям.',stats:[['Урон тика','2,65 + 0,70 × L'],['Дополнительные лучи','бонус снарядов · 50% урона'],['Интервал тика','0,18 / темп сек'],['Максимальный разгон','×1,50'],['Дальность','27'],['Разгон за тик','5,5% + 0,8% × L']],impacts:['Урон героя','Темп атак','Снаряды','Метка преследования']},
    mines:{summary:'Раскладывает по одной мине около героя. Параметр снарядов не дублирует мины.',stats:[['Урон','35 + 7 × (L − 1)'],['Мин за установку','1'],['Радиус взрыва','2,20 + 0,08 × L'],['Радиус детонации','1,15 + 0,04 × L'],['Максимум мин','5 + ⌊L / 2⌋'],['Длительность','12 + 0,45 × L сек'],['Перезарядка','(1,30 − 0,035 × L) / темп сек']],impacts:['Урон героя','Темп атак','Размер атак','Длительность','Урон по площади']},
    mortar:{summary:'Бьёт в наиболее плотную группу. Дополнительные ионные заряды от параметра снарядов наносят 50% урона.',stats:[['Урон','42 + 9 × (L − 1)'],['Дополнительные попадания','бонус снарядов · 50% урона'],['Радиус','2,70 + 0,13 × L'],['Перезарядка','(2,40 − 0,08 × L) / темп сек'],['Бонус от плотности','до −35% перезарядки']],impacts:['Урон героя','Темп атак','Снаряды','Размер атак','Урон по площади']},
    chrononeedles:{summary:'Быстрые иглы накладывают суммирующееся замедление и могут выпускаться несколькими снарядами.',stats:[['Урон','9 + 2,4 × (L − 1)'],['Снаряды','min(бонус героя + ⌊(L − 1) / 3⌋, 12)'],['Пробитие','1 + ⌊L / 4⌋'],['Замедление','4% за иглу, максимум 40%'],['Длительность метки','1,70 + 0,14 × L сек'],['Перезарядка','(0,52 − 0,018 × L) / темп сек']],impacts:['Урон героя','Темп атак','Снаряды','Пробитие','Калибр','Скорость снарядов']},
    seismic:{summary:'Ударная волна расходится от героя, отталкивает обычных врагов и теряет урон с расстоянием.',stats:[['Урон в центре','26 + 6 × (L − 1)'],['Урон по расстоянию','×1,00 → ×0,50 у края'],['Радиус','6,20 + 0,35 × L'],['Длительность волны','0,72 сек'],['Урон боссам','×1,30'],['Сила отталкивания','0,70'],['Перезарядка','(2,05 − 0,055 × L) / темп сек']],impacts:['Урон героя','Темп атак','Размер атак','Урон боссам','Отталкивание']},
    nanoswarm:{summary:'Выпускает рой автономных жуков, которые находят цели и делают несколько атак до исчезновения.',stats:[['Урон укуса','6 + 2,2 × L'],['Жуки','3 + ⌊(L − 1) / 2⌋'],['Атак у жука','3 + ⌊L / 4⌋'],['Жизнь жука','4,20 сек'],['Перезарядка','(2,25 − 0,07 × L) / темп сек']],impacts:['Урон героя','Темп атак','Калибр','Призывы']},
    mirrordisc:{summary:'Диск рядом с героем наносит контактный урон и перехватывает редкие вражеские снаряды. Параметр снарядов делит каждое отражение на дополнительные копии.',stats:[['Урон касания','8 + 4 × L'],['Интервал по цели','0,42 сек'],['Отражённые снаряды','1 + бонус снарядов'],['Урон отражения','50% урона врага × (1 + 0,08 × L)'],['Пробитие отражения','2 + ⌊L / 3⌋'],['Интервал отражения','max(0,30; 1,25 − 0,10 × L) сек']],impacts:['Урон героя','Снаряды','Калибр','Защита от снарядов','Отражение']},
    resonance:{summary:'Каждый следующий импульс усиливается. Получение урона сбрасывает половину накопленного резонанса.',stats:[['Базовый урон','12 + 4 × (L − 1)'],['Бонус за заряд','+15%'],['Максимум зарядов','10'],['Радиус','4,40 + 0,32 × L'],['Перезарядка','(1,50 − 0,04 × L) / темп сек']],impacts:['Урон героя','Темп атак','Размер атак','Серия без получения урона']}
  };
  const DAMAGE_SOURCE_NAMES={blaster:'Осколочный залп',aura:'Нулевая аура',orbit:'Орбитальные клинки',lightning:'Цепь молний',storm:'Вечная гроза',meteor:'Метеоритный дождь',saw:'Пила разрыва',frost:'Крио-импульс',drone:'Дроны-охотники',gravity:'Гравитационный колодец',voidPressure:'Давление пустоты',firetrail:'Огненный след',riftlance:'Копьё Разлома',riftScar:'Прокол Реальности',boomerang:'Призрачный бумеранг',prism:'Кристальный призматор',mines:'Минный фабрикатор',mineLink:'Нулевая территория',mortar:'Ионный миномёт',chrononeedles:'Хроно-иглы',seismic:'Сейсмическое ядро',nanoswarm:'Нанорой',mirrorDisc:'Зеркальный диск',reflected:'Отражённый снаряд',resonance:'Резонансный колокол',engineerTurret:'Турели Инженера',necrominion:'Мертвецы Некроманта',pyroblast:'Взрыв Пироманта',guardianNova:'Волна Стража',mimic:'Эхо Мимика',mimicSpecial:'Украденная атака',discharge:'Разрядный конденсатор',shardburst:'Осколочный накопитель',unstableDuplicate:'Нестабильный дубликатор',corpseFire:'Пепел к пеплу',killnova:'Реактор бойни',critburst:'Критическая масса',thorns:'Ответный BONK',normal:'Прочий урон'};
  const DAMAGE_SOURCE_WEAPON={blaster:'blaster',aura:'aura',orbit:'orbit',lightning:'lightning',storm:'lightning',meteor:'meteor',saw:'saw',frost:'frost',drone:'drone',gravity:'gravity',voidPressure:'gravity',firetrail:'firetrail',riftlance:'riftlance',riftScar:'riftlance',boomerang:'boomerang',prism:'prism',mines:'mines',mineLink:'mines',mortar:'mortar',chrononeedles:'chrononeedles',seismic:'seismic',nanoswarm:'nanoswarm',mirrorDisc:'mirrordisc',reflected:'mirrordisc',resonance:'resonance'};
  const PROJECTILE_DAMAGE_SOURCES=new Set(['blaster','meteor','saw','drone','riftlance','boomerang','prism','mortar','chrononeedles','nanoswarm']);

  const CONSUMABLES = {
    magnet:{name:'Магнитный импульс',icon:'∪',color:'#38f3ff',rgb:COLORS.cyan,duration:9,desc:'Весь опыт на карте летит к герою'},
    immortal:{name:'Абсолютный щит',icon:'⬢',color:'#ffbd3d',rgb:COLORS.amber,duration:7,desc:'Полное бессмертие'},
    speed:{name:'Хроно-ускоритель',icon:'»',color:'#58ff91',rgb:COLORS.green,duration:11,desc:'Скорость движения и атак ×1.7'},
    double:{name:'Красный резонатор',icon:'×2',color:'#a966ff',rgb:COLORS.violet,duration:12,desc:'Двойной урон'},
    heal:{name:'Ремонтный заряд',icon:'✚',color:'#8cffb0',rgb:COLORS.white,duration:0,desc:'Восстанавливает 35% здоровья'}
  };
  const CHALLENGES = {
    classic:{name:'КЛАССИЧЕСКИЙ РАЗЛОМ',desc:'Обычные правила · seed фиксирует ключевые события'},
    inferno:{name:'ОГНЕННЫЙ ОБЕТ',desc:'Только Огненный след · начальное оружие заменено'},
    elite:{name:'ЭЛИТНЫЙ НАТИСК',desc:'Каждый обычный враг элитный · награды ×1.5',reward:1.5},
    ascended:{name:'ВОЗНЕСЁННЫЙ АРСЕНАЛ',desc:'Пять эволюций сразу · здоровье врагов ×5',health:5,damage:1.75,spawn:1.5,reward:1.75},
    bossrush:{name:'ПАРАД ТИТАНОВ',desc:'Шесть боссов за забег · больше босс-реликвий',bossRush:true,reward:1.2}
  };

  let selectedGraphics='normal',selectedRunPace='standard',selectedChallenge='classic',selectedSeed='',selectedMap='normal';
  try{const savedGraphics=localStorage.getItem('riftGraphics');if(savedGraphics==='rtx'||savedGraphics==='normal')selectedGraphics=savedGraphics;}catch(_error){}
  try{const savedPace=localStorage.getItem('riftRunPace');if(RUN_PACES[savedPace])selectedRunPace=savedPace;}catch(_error){}
  try{const savedChallenge=localStorage.getItem('riftChallenge');if(CHALLENGES[savedChallenge])selectedChallenge=savedChallenge;selectedSeed=normalizeSeed(localStorage.getItem('riftSeed')||'');}catch(_error){}
  try{const savedMap=localStorage.getItem('riftMap');if(['normal','obstacles'].includes(savedMap))selectedMap=savedMap;}catch(_error){}
  const CUSTOM_DEFAULTS={health:1,damage:1,speed:1,spawn:1,scaling:1,threatRate:1,elite:1,bossHealth:1,bossCopies:1,hordeSize:1,hordeInterval:1,rift:1};
  const CUSTOM_LIMITS={health:[.25,4],damage:[.25,3],speed:[.5,1.8],spawn:[.25,3],scaling:[.25,2.5],threatRate:[.5,2],elite:[0,3],bossHealth:[.25,5],bossCopies:[1,5],hordeSize:[.25,3],hordeInterval:[.5,2],rift:[0,2]};
  function sanitizeCustomSettings(raw={}){const clean={};for(const [key,value] of Object.entries(CUSTOM_DEFAULTS)){const range=CUSTOM_LIMITS[key],number=Number(raw[key]);clean[key]=clamp(Number.isFinite(number)?number:value,range[0],range[1]);if(key==='bossCopies')clean[key]=Math.round(clean[key]);}return clean;}
  let customSettings={...CUSTOM_DEFAULTS};
  try{customSettings=sanitizeCustomSettings(JSON.parse(localStorage.getItem('riftCustomDifficulty')||'{}'));}catch(_error){}
  let selectedHero='vanguard',selectedDifficulty='normal',menuPage='home';
  let state={mode:'menu'};
  let player={x:0,z:0,y:0};
  let cameraMode='overhead',cameraYaw=0,cameraPitch=-.06;
  let coopActors=[],activeActorId='p1',remotePlayer=null,nextNetId=1;
  const coopNet={mode:'solo',socket:null,room:'',connected:false,peerReady:null,addresses:[],seq:0,snapshotClock:0,inputClock:0,lastSnapshot:0,lastSnapshotSeq:0,buildReady:false,buildDirty:false,totemKey:'',reconnectTimer:0,manualClose:false,guestConfig:null};
  let enemies=[],projectiles=[],enemyProjectiles=[],gems=[],particles=[],beams=[],zones=[],consumables=[],worldTotems=[],heroUnits=[],obstacles=[],obstacleGrid=new Map(),generatedObstacleCells=new Set(),obstacleGenerationX=Infinity,obstacleGenerationZ=Infinity,activeStandards=[],playerAttacksFaded=false,aoeVisualCulling=false,visibleAoeTotal=0,visibleAoeCulled=0,nextZoneVisualId=1,lastViewProjection=null,lastViewFirstPerson=false,combatTextBuckets=new Map(),combatTexts=[];
  const entityPools={enemy:[],projectile:[],enemyProjectile:[],particle:[],gem:[],consumable:[]},entityPoolLimits={enemy:1100,projectile:5000,enemyProjectile:600,particle:1800,gem:1800,consumable:80},combatTextNodePool=[];
  const visibleFrame={enemies:[],projectiles:[],enemyProjectiles:[],gems:[],particles:[],beams:[],zones:[],consumables:[],worldTotems:[],heroUnits:[]},visibleFrameLists=Object.values(visibleFrame);
  const visibleAoeCandidates=[],visibleAoeNear=[],visibleAoeKinds=new Set();
  const ENEMY_SPATIAL_CELL=6,ENEMY_SPATIAL_STALE_PAD=6,enemyCandidateScratch=Array.from({length:256},()=>[]),enemySpatialBucketPool=[];let enemySpatialGrid=new Map(),enemySpatialDirty=true,enemyCandidateScratchIndex=0;
  let keys={},touchMove={x:0,z:0},choiceKind='level',currentChoices=[],choiceActionMode='';
  let last=performance.now(),ambientTime=0,shake=0,uiTick=0,uiSlowTick=0,pendingLevels=0,pendingChests=0;
  function acquirePooled(type){const pool=entityPools[type],entity=pool?.pop()||{},hit=entity.hit instanceof Set?entity.hit:null;for(const key of Object.keys(entity))if(key!=='hit')delete entity[key];if(hit)hit.clear();return entity;}
  function recyclePooled(type,entity){const pool=entityPools[type];if(!pool||!entity||pool.length>=entityPoolLimits[type])return;if(entity.hit instanceof Set)entity.hit.clear();pool.push(entity);}
  function removePooledAt(list,index,type){const entity=list[index];list.splice(index,1);recyclePooled(type,entity);}
  function spawnPlayerProjectile(data){const entity=acquirePooled('projectile'),hit=entity.hit instanceof Set?entity.hit:new Set();Object.assign(entity,data);hit.clear();entity.hit=hit;projectiles.push(entity);return entity;}
  function spawnEnemyProjectile(data){const entity=acquirePooled('enemyProjectile');Object.assign(entity,data);enemyProjectiles.push(entity);return entity;}
  function enemySpatialKey(cx,cz){return((cx&65535)<<16)^(cz&65535);}
  function rebuildEnemySpatialGrid(){for(const bucket of enemySpatialGrid.values()){bucket.length=0;enemySpatialBucketPool.push(bucket);}enemySpatialGrid.clear();for(const enemy of enemies){if(enemy.dead)continue;const key=enemySpatialKey(Math.floor(enemy.x/ENEMY_SPATIAL_CELL),Math.floor(enemy.z/ENEMY_SPATIAL_CELL)),bucket=enemySpatialGrid.get(key);if(bucket)bucket.push(enemy);else{const next=enemySpatialBucketPool.pop()||[];next.push(enemy);enemySpatialGrid.set(key,next);}}enemySpatialDirty=false;}
  function enemyCandidates(x,z,range=Infinity){if(!Number.isFinite(range)||range>=46)return enemies;if(enemySpatialDirty)rebuildEnemySpatialGrid();const result=enemyCandidateScratch[enemyCandidateScratchIndex++%enemyCandidateScratch.length];result.length=0;const cellRange=Math.ceil((Math.max(0,range)+ENEMY_SPATIAL_STALE_PAD)/ENEMY_SPATIAL_CELL),cx=Math.floor(x/ENEMY_SPATIAL_CELL),cz=Math.floor(z/ENEMY_SPATIAL_CELL);for(let ox=-cellRange;ox<=cellRange;ox++)for(let oz=-cellRange;oz<=cellRange;oz++){const bucket=enemySpatialGrid.get(enemySpatialKey(cx+ox,cz+oz));if(bucket)result.push(...bucket);}return result;}
  function clipVisible(matrix,x,y,z,radius=0){const cx=matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],cy=matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],cz=matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14],cw=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];if(cw<=.001)return false;const margin=.08+Math.min(.62,Math.max(0,radius)*.035),nx=cx/cw,ny=cy/cw,nz=cz/cw;return nz>=-1.15&&nz<=1.15&&Math.abs(nx)<=1+margin&&Math.abs(ny)<=1+margin;}
  function aoeVisualCost(zone){return clamp(Math.max(.15,zone.radius||1)/3,.65,3.5);}
  function aoeVisualRank(zone){if(!Number.isFinite(zone._visualRank)){const id=nextZoneVisualId++,hash=Math.imul(id^(id>>>16),2246822507)>>>0;zone._visualId=id;zone._visualRank=hash/4294967296;}return zone._visualRank;}
  function selectVisibleAoe(){
    visibleAoeTotal=visibleAoeCandidates.length;visibleAoeCulled=0;if(!visibleAoeTotal){aoeVisualCulling=false;return;}
    let totalCost=0;for(const zone of visibleAoeCandidates)totalCost+=aoeVisualCost(zone);
    if(aoeVisualCulling){if(visibleAoeTotal<=AOE_VISUAL_EXIT_COUNT&&totalCost<=AOE_VISUAL_BUDGET*.8)aoeVisualCulling=false;}
    else if(visibleAoeTotal>AOE_VISUAL_ENTER_COUNT||totalCost>AOE_VISUAL_BUDGET*1.1)aoeVisualCulling=true;
    if(!aoeVisualCulling){visibleFrame.zones.push(...visibleAoeCandidates);return;}
    visibleAoeNear.length=0;visibleAoeKinds.clear();for(const zone of visibleAoeCandidates){aoeVisualRank(zone);zone._visualSelected=false;zone._visualProximity=Math.max(0,Math.hypot(zone.x-player.x,zone.z-player.z)-Math.max(.15,zone.radius||1));if(zone._visualProximity<=2.5)visibleAoeNear.push(zone);}visibleAoeCandidates.sort((a,b)=>a._visualRank-b._visualRank);visibleAoeNear.sort((a,b)=>a._visualProximity-b._visualProximity||a._visualRank-b._visualRank);
    let budget=AOE_VISUAL_BUDGET,rendered=0;
    for(const zone of visibleAoeNear){if(rendered>=6)break;const kind=zone.kind||'aoe';visibleAoeKinds.add(kind);zone._visualSelected=true;visibleFrame.zones.push(zone);budget-=aoeVisualCost(zone);rendered++;}
    for(const zone of visibleAoeCandidates){const kind=zone.kind||'aoe';if(zone._visualSelected||visibleAoeKinds.has(kind)||rendered>=AOE_VISUAL_HARD_LIMIT)continue;visibleAoeKinds.add(kind);zone._visualSelected=true;visibleFrame.zones.push(zone);budget-=aoeVisualCost(zone);rendered++;}
    for(const zone of visibleAoeCandidates){if(zone._visualSelected||rendered>=AOE_VISUAL_HARD_LIMIT)continue;const cost=aoeVisualCost(zone);if(cost>budget&&rendered>=6)continue;zone._visualSelected=true;visibleFrame.zones.push(zone);budget-=cost;rendered++;}
    visibleAoeCulled=Math.max(0,visibleAoeTotal-rendered);
  }
  function collectVisibleFrame(matrix,menu=false){
    for(const list of visibleFrameLists)list.length=0;visibleAoeCandidates.length=0;visibleAoeTotal=0;visibleAoeCulled=0;if(menu){aoeVisualCulling=false;return visibleFrame;}
    for(const enemy of enemies)if(!enemy.dead&&clipVisible(matrix,enemy.x,Math.max(.7,enemy.size),enemy.z,enemy.size*2.5))visibleFrame.enemies.push(enemy);
    for(const p of projectiles)if(clipVisible(matrix,p.x,p.y||.8,p.z,(p.size||.2)*4))visibleFrame.projectiles.push(p);
    for(const p of enemyProjectiles)if(clipVisible(matrix,p.x,p.y||.8,p.z,(p.size||.2)*4))visibleFrame.enemyProjectiles.push(p);
    for(const g of gems)if(clipVisible(matrix,g.x,.5,g.z,.6))visibleFrame.gems.push(g);
    for(const p of particles)if(clipVisible(matrix,p.x,p.y,p.z,(p.size||.1)*2))visibleFrame.particles.push(p);
    for(const z of zones)if(clipVisible(matrix,z.x,.1,z.z,z.radius||1)){if(String(z.kind).startsWith('enemy'))visibleFrame.zones.push(z);else visibleAoeCandidates.push(z);}selectVisibleAoe();
    for(const b of beams){const mx=(b.x1+b.x2)*.5,mz=(b.z1+b.z2)*.5;if(clipVisible(matrix,b.x1,1,b.z1,.5)||clipVisible(matrix,b.x2,1,b.z2,.5)||clipVisible(matrix,mx,1,mz,Math.hypot(b.x2-b.x1,b.z2-b.z1)*.5))visibleFrame.beams.push(b);}
    for(const c of consumables)if(clipVisible(matrix,c.x,.8,c.z,1.5))visibleFrame.consumables.push(c);
    for(const t of worldTotems)if(clipVisible(matrix,t.x,1.5,t.z,3.5))visibleFrame.worldTotems.push(t);
    for(const unit of heroUnits)if(clipVisible(matrix,unit.x,.8,unit.z,1.5))visibleFrame.heroUnits.push(unit);return visibleFrame;
  }
  const rtxEnabled=()=>state.mode==='menu'?selectedGraphics==='rtx':state.graphics==='rtx';
  const runPaceInfo=()=>RUN_PACES[state.runPace]||RUN_PACES.standard;
  const runDuration=()=>Number(state.runDuration)||runPaceInfo().duration;
  const runTimelineScale=()=>Number(state.timelineScale)||runPaceInfo().timelineScale;
  const runTimelineTime=(time=state.time||0)=>time*runTimelineScale();
  const pacedDelay=seconds=>seconds/runTimelineScale();
  const isFirstPerson=()=>cameraMode==='first'&&state.mode!=='menu';
  function syncCameraUI(){
    const first=isFirstPerson(),hud=$('#firstPersonHud');document.body.classList.toggle('first-person-mode',first);if(hud){hud.classList.toggle('hidden',!first);hud.setAttribute('aria-hidden',String(!first));}
    canvas.dataset.cameraMode=first?'first':'overhead';canvas.dataset.mainWeaponAim=first?'camera':'automatic';canvas.dataset.cameraYaw=String(cameraYaw);canvas.dataset.cameraPitch=String(cameraPitch);
  }
  function releaseCameraPointerLock(){if(document.pointerLockElement===canvas)document.exitPointerLock?.();}
  function requestCameraPointerLock(){
    if(!isFirstPerson()||!['playing','remote'].includes(state.mode)||document.pointerLockElement===canvas)return;
    try{const result=canvas.requestPointerLock?.();if(result?.catch)result.catch(()=>{});}catch(_error){}
  }
  function setCameraMode(mode,sound=true){
    const next=mode==='first'?'first':'overhead';if(next==='first'&&!['playing','remote','paused'].includes(state.mode))return;
    cameraMode=next;if(next==='first'){cameraYaw=Number.isFinite(player.dir)?player.dir:cameraYaw;cameraPitch=-.06;requestCameraPointerLock();}else releaseCameraPointerLock();const actor=coopActors.find(item=>item.local);if(actor){actor.firstPerson=next==='first';actor.aimYaw=cameraYaw;actor.aimPitch=cameraPitch;}syncCameraUI();
    if(sound){toast(next==='first'?'<b>ПЕРВОЕ ЛИЦО</b> · мышь — обзор · Осколочный залп стреляет по прицелу':'<b>ВИД СВЕРХУ</b> · автоматическое наведение восстановлено',next==='first'?'#38f3ff':'#a56cff');audio.init();audio.tone(next==='first'?620:330,.1,'triangle',.024);}
  }
  function cameraRelativeInput(x,z){
    if(!isFirstPerson())return{x,z};const forward=-z,strafe=x,side=cameraYaw+Math.PI/2;
    return{x:Math.cos(cameraYaw)*forward+Math.cos(side)*strafe,z:Math.sin(cameraYaw)*forward+Math.sin(side)*strafe};
  }

  const audio = {
    ctx:null,
    init(){ if(!this.ctx) this.ctx=new (window.AudioContext||window.webkitAudioContext)(); if(this.ctx.state==='suspended')this.ctx.resume(); },
    tone(freq=300,dur=.05,type='sine',vol=.025){
      if(!this.ctx)return;const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(40,freq*.72),t+dur);
      g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g).connect(this.ctx.destination);o.start(t);o.stop(t+dur);
    }
  };

  function defaultStats(heroId=selectedHero,hardcoreMode=selectedDifficulty==='hardcore') {
    const h=HEROES[heroId]||HEROES.vanguard,hardcore=hardcoreMode,maxHp=hardcore?1:h.maxHp,baseDamage=h.damage*HERO_BASE_DAMAGE_MULTIPLIER;
    return {
      baseDamage,damageMult:baseDamage,fireRate:h.fireRate||1,speed:h.speed,maxHp,hp:maxHp,armor:h.armor,pickup:4,
      crit:h.crit,critMult:2,projectiles:1,pierce:h.pierce,projSize:1,projSpeed:h.projSpeed||1,projectileDamage:1,duration:h.duration||1,xpMult:1,regen:0,luck:0,
      echo:0,critExplosion:0,feedback:0,blood:0,bloodBonus:0,levelPower:0,levelPowerBonus:0,execute:0,thorns:0,lifesteal:0,killNova:0,killNovaProgress:0,
      shieldMax:0,shield:0,shieldClock:0,dropLuck:0,revives:0,corpseFire:0,desperation:0,chainBonus:0,bossSlayer:0,crowdPower:0,levelHeal:0,burnPower:0,
      inertiaFlywheel:0,hunterAnchor:0,thermoSiphon:0,thermoHealClock:0,dischargeCap:0,dischargeHits:0,cryoCapillary:0,emergencyTeleport:0,teleportCooldown:0,pocketForge:0,forgeWeapons:[],shardAccumulator:0,shardCharge:0,blackPowder:0,riftStabilizer:0,gildedLure:0,soulCollector:0,soulCharges:0,reversedClock:0,pursuitMark:0,pursuitTarget:0,pursuitTime:0,unstableDuplicator:0,bloodContract:0,cleanupProtocol:0,cleanupStacks:0,cleanupTimer:0,
      heroClock:heroId==='engineer'?5:heroId==='chronomancer'?8:0,mimicShotClock:.2,mimicSpecialClock:5,gamblerMilestone:0,level:1,xp:0,xpNeed:xpNeedForLevel(1),kills:0,damageDone:0,damageTaken:0,criticalHits:0,healingDone:0,damageBlocked:0,overkillPrevented:0,bestDps:0,lastDps:0,dpsWindow:0,dpsClock:1,recentDpsTotal:0,
      damageBySource:{},killsBySource:{},lifestealWindow:0,lifestealWindowClock:1,feedbackCutUsed:0,feedbackWindowClock:1,riftResonanceChoices:0,riftWeaponPower:{},riftLastWeapon:'',recentDamage:TELEMETRY_ENABLED?{}:null,damageHistory:TELEMETRY_ENABLED?[]:null,recentDpsBySource:TELEMETRY_ENABLED?{}:null,forge:{rerolls:3,banishes:3,holds:2,bloodTrades:0,banished:[],kept:''}
    };
  }
  const freshWeapons=()=>({blaster:1,aura:0,orbit:0,lightning:0,meteor:0,saw:0,frost:0,drone:0,gravity:0,firetrail:0,riftlance:0,boomerang:0,prism:0,mines:0,mortar:0,chrononeedles:0,seismic:0,nanoswarm:0,mirrordisc:0,resonance:0});
  const freshCooldowns=()=>({blaster:.2,aura:1,lightning:2,meteor:3,saw:2,frost:3,drone:1,gravity:5,firetrail:.3,riftlance:1,boomerang:1,prism:.2,mines:1,mortar:2,chrononeedles:.4,seismic:1.5,nanoswarm:1,mirrordisc:.2,resonance:1});
  const freshBuffs=()=>({magnet:0,immortal:0,speed:0,double:0,duelist:0});
  function makeRun() {
    const s=defaultStats(),custom=selectedDifficulty==='custom'?sanitizeCustomSettings(customSettings):{...CUSTOM_DEFAULTS},pace=RUN_PACES[selectedRunPace]||RUN_PACES.standard,challenge=CHALLENGES[selectedChallenge]||CHALLENGES.classic,seedCode=normalizeSeed(selectedSeed)||randomSeed(),seedHolder={value:seedHash(`${seedCode}:${selectedChallenge}`)},nextRandom=()=>seededValue(seedHolder),bossOrder=['breaker','worm','architect','swarmking','mirror'];
    for(let i=bossOrder.length-1;i>0;i--){const j=Math.floor(nextRandom()*(i+1));[bossOrder[i],bossOrder[j]]=[bossOrder[j],bossOrder[i]];}const initialHorde=(180+nextRandom()*120)*custom.hordeInterval/pace.timelineScale;
    selectedSeed=seedCode;const seedInput=$('#runSeedInput');if(seedInput)seedInput.value=seedCode;
    return {
      mode:'playing',time:0,runPace:selectedRunPace,runDuration:pace.duration,timelineScale:pace.timelineScale,xpPace:pace.xpPace,challenge:selectedChallenge,challengeName:challenge.name,seedCode,seedState:seedHolder.value,bossOrder,bossOrderIndex:0,spawnClock:0,spawnThreatBank:0,bossIndex:0,milestoneIndex:0,nextTotem:75/pace.timelineScale,nextHorde:initialHorde,hordeRemaining:0,hordeDuration:0,hordeSpawnRate:0,hordeSpawnBudget:0,hordes:0,threatTier:0,lateScaleAnnounced:false,lateHealthScale:1,lateDamageScale:1,adaptive:{health:1,damage:1,speed:1,eliteBonus:0,threatWeight:0,targetHealth:1,targetDamage:1,targetSpeed:1,expectedLevel:1,levelPressure:0,buildPressure:0,performancePressure:0,stationaryPressure:0,pressure:0,dominant:false,killRate:0,lastKills:0,sampleClock:2,sampleElapsed:0,samples:0},balance:TELEMETRY_ENABLED?{version:BALANCE_REPORT_VERSION,sampleClock:0,sampleElapsed:0,samples:[],events:[],lastKills:0,lastDamageTaken:0,lastHealing:0,lastX:0,lastZ:0,stationaryTime:0,activeTime:0,fpsTotal:0,fpsFrames:0}:null,endless:false,endlessNextBoss:0,endlessNextTotem:0,endlessRecorded:false,stats:s,
      weapons:freshWeapons(),cooldowns:freshCooldowns(),relics:{},totems:{},
      difficulty:{spawn:custom.spawn*(challenge.spawn||1),health:custom.health*(challenge.health||1),damage:custom.damage*(challenge.damage||1),speed:custom.speed,bosses:custom.bossCopies,reward:challenge.reward||1,scaling:custom.scaling,threatRate:custom.threatRate,elite:custom.elite,bossHealth:custom.bossHealth,hordeSize:custom.hordeSize,hordeInterval:custom.hordeInterval,rift:custom.rift},
      buffs:freshBuffs(),
      hero:selectedHero,hardcore:selectedDifficulty==='hardcore',custom:selectedDifficulty==='custom',graphics:selectedGraphics,map:selectedMap,lastHit:0,invuln:0,screenPulse:0
    };
  }
  const OBSTACLE_CELL_SIZE=10,OBSTACLE_MAX_HALF=3.2;
  const obstacleCellKey=(x,z)=>`${Math.floor(x/OBSTACLE_CELL_SIZE)}:${Math.floor(z/OBSTACLE_CELL_SIZE)}`;
  function rebuildObstacleGrid(){
    obstacleGrid=new Map();for(const obstacle of obstacles){const key=obstacleCellKey(obstacle.x,obstacle.z),bucket=obstacleGrid.get(key);if(bucket)bucket.push(obstacle);else obstacleGrid.set(key,[obstacle]);}
  }
  function generateObstacleCell(gx,gz){
    const cell=`${gx}:${gz}`;if(generatedObstacleCells.has(cell))return;generatedObstacleCells.add(cell);const holder={value:seedHash(`${state.seedCode}:obstacle-map:${cell}`)},next=()=>seededValue(holder);if(next()>.43)return;
    const x=gx*OBSTACLE_CELL_SIZE+(next()-.5)*4.2,z=gz*OBSTACLE_CELL_SIZE+(next()-.5)*4.2;if(x*x+z*z<9.5**2)return;const long=next()<.38,vertical=next()<.5,wide=long?1.7+next()*1.35:.8+next()*.75,narrow=.72+next()*.65,hx=vertical?narrow:wide,hz=vertical?wide:narrow,obstacle={x,z,hx,hz,height:2.2+next()*2.6,variant:Math.floor(next()*3),seed:next()*TAU};
    obstacles.push(obstacle);const key=obstacleCellKey(x,z),bucket=obstacleGrid.get(key);if(bucket)bucket.push(obstacle);else obstacleGrid.set(key,[obstacle]);
  }
  function ensureMapObstacles(x,z,force=false){
    if(state.map!=='obstacles')return;const centerX=Math.floor(x/OBSTACLE_CELL_SIZE),centerZ=Math.floor(z/OBSTACLE_CELL_SIZE);if(!force&&Math.abs(centerX-obstacleGenerationX)<4&&Math.abs(centerZ-obstacleGenerationZ)<4)return;
    for(let gx=centerX-11;gx<=centerX+11;gx++)for(let gz=centerZ-11;gz<=centerZ+11;gz++)generateObstacleCell(gx,gz);obstacleGenerationX=centerX;obstacleGenerationZ=centerZ;canvas.dataset.obstacles=String(obstacles.length);
  }
  function generateMapObstacles(){
    obstacles=[];obstacleGrid=new Map();generatedObstacleCells=new Set();obstacleGenerationX=Infinity;obstacleGenerationZ=Infinity;if(state.map!=='obstacles'){canvas.dataset.map=state.map||'normal';canvas.dataset.obstacles='0';canvas.dataset.obstacleSignature='';return;}
    ensureMapObstacles(0,0,true);canvas.dataset.map='obstacles';canvas.dataset.obstacleSignature=obstacles.slice(0,12).map(obstacle=>`${obstacle.x.toFixed(2)},${obstacle.z.toFixed(2)},${obstacle.hx.toFixed(2)},${obstacle.hz.toFixed(2)}`).join('|');
  }
  function nearbyObstacles(x,z,radius=0){
    if(!obstacles.length)return[];const reach=radius+OBSTACLE_MAX_HALF,minX=Math.floor((x-reach)/OBSTACLE_CELL_SIZE),maxX=Math.floor((x+reach)/OBSTACLE_CELL_SIZE),minZ=Math.floor((z-reach)/OBSTACLE_CELL_SIZE),maxZ=Math.floor((z+reach)/OBSTACLE_CELL_SIZE),found=[];
    for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){const bucket=obstacleGrid.get(`${gx}:${gz}`);if(bucket)found.push(...bucket);}return found;
  }
  function pointBlockedByObstacle(x,z,radius=0){return nearbyObstacles(x,z,radius).some(obstacle=>Math.abs(x-obstacle.x)<obstacle.hx+radius&&Math.abs(z-obstacle.z)<obstacle.hz+radius);}
  function obstacleSegmentHitT(x1,z1,x2,z2,padding=0){
    if(!obstacles.length)return Infinity;const dx=x2-x1,dz=z2-z1,midX=(x1+x2)/2,midZ=(z1+z2)/2,reach=Math.hypot(dx,dz)/2+padding,buckets=nearbyObstacles(midX,midZ,reach),seen=new Set();let best=Infinity;
    obstacleLoop:for(const obstacle of buckets){if(seen.has(obstacle))continue;seen.add(obstacle);let tMin=0,tMax=1;for(const [start,delta,min,max] of [[x1,dx,obstacle.x-obstacle.hx-padding,obstacle.x+obstacle.hx+padding],[z1,dz,obstacle.z-obstacle.hz-padding,obstacle.z+obstacle.hz+padding]]){if(Math.abs(delta)<1e-7){if(start<min||start>max)continue obstacleLoop;continue;}let a=(min-start)/delta,b=(max-start)/delta;if(a>b)[a,b]=[b,a];tMin=Math.max(tMin,a);tMax=Math.min(tMax,b);if(tMin>tMax)continue obstacleLoop;}if(tMax>=0&&tMin<=1)best=Math.min(best,Math.max(0,tMin));}
    return best;
  }
  function lineBlockedByObstacle(x1,z1,x2,z2,padding=0){return obstacleSegmentHitT(x1,z1,x2,z2,padding)<=1;}
  function obstacleRayDistance(x,z,dx,dz,distance,padding=0){const t=obstacleSegmentHitT(x,z,x+dx*distance,z+dz*distance,padding);return Number.isFinite(t)?Math.max(0,distance*t):distance;}
  function moveWithObstacles(entity,dx,dz,radius=.5){
    if(!obstacles.length){entity.x+=dx;entity.z+=dz;return true;}let clear=true;const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.32)),stepX=dx/steps,stepZ=dz/steps;
    for(let step=0;step<steps;step++){let old=entity.x;entity.x+=stepX;if(pointBlockedByObstacle(entity.x,entity.z,radius)){entity.x=old;clear=false;}old=entity.z;entity.z+=stepZ;if(pointBlockedByObstacle(entity.x,entity.z,radius)){entity.z=old;clear=false;}}
    return clear;
  }
  function resolveObstacleOverlaps(entity,radius=.5){
    if(!obstacles.length)return entity;for(let pass=0;pass<4;pass++){let moved=false;for(const obstacle of nearbyObstacles(entity.x,entity.z,radius)){const left=obstacle.x-obstacle.hx-radius,right=obstacle.x+obstacle.hx+radius,top=obstacle.z-obstacle.hz-radius,bottom=obstacle.z+obstacle.hz+radius;if(entity.x<=left||entity.x>=right||entity.z<=top||entity.z>=bottom)continue;const choices=[[Math.abs(entity.x-left),0,left-.01],[Math.abs(right-entity.x),0,right+.01],[Math.abs(entity.z-top),1,top-.01],[Math.abs(bottom-entity.z),1,bottom+.01]].sort((a,b)=>a[0]-b[0]),choice=choices[0];if(choice[1]===0)entity.x=choice[2];else entity.z=choice[2];moved=true;}if(!moved)break;}return entity;
  }
  function captureLocalActor(id='p1',name='Игрок 1'){
    return{id,name,entity:player,stats:state.stats,weapons:state.weapons,cooldowns:state.cooldowns,relics:state.relics,buffs:state.buffs,hero:state.hero,hardcore:state.hardcore,invuln:state.invuln||0,debugGod:false,pendingLevels,pendingChests,pendingTotems:0,pendingEndless:0,currentChoices,choiceKind,choice:null,input:{x:0,z:0},connected:true,local:true,firstPerson:false,aimYaw:0,aimPitch:-.06};
  }
  function createActor(id,name,hero='vanguard',hardcore=false){
    return{id,name,entity:{x:id==='p2'?1.4:-1.4,z:0,y:0,dir:0,moving:false},stats:defaultStats(hero,hardcore),weapons:freshWeapons(),cooldowns:freshCooldowns(),relics:{},buffs:freshBuffs(),hero,hardcore,invuln:0,debugGod:false,pendingLevels:0,pendingChests:0,pendingTotems:0,pendingEndless:0,currentChoices:[],choiceKind:'level',choice:null,input:{x:0,z:0},connected:true,local:false,firstPerson:false,aimYaw:0,aimPitch:-.06};
  }
  function applyChallengeLoadout(actor=null){
    withActor(actor,()=>{
      if(state.challenge==='inferno'){for(const id of Object.keys(state.weapons))state.weapons[id]=0;state.weapons.firetrail=1;state.cooldowns.firetrail=.1;}
      if(state.challenge==='ascended'){const arsenal=Object.keys(state.weapons).slice(0,currentWeaponSlotLimit());for(const id of Object.keys(state.weapons))state.weapons[id]=arsenal.includes(id)?8:0;for(const evolution of evolutionUpgrades)if(arsenal.includes(evolution.weapon))state.relics[evolution.id]=1;}
    });
  }
  function currentWeaponSlotLimit(){return HEROES[state?.hero||selectedHero]?.weaponSlots||WEAPON_SLOT_LIMIT;}
  function applyHeroLoadout(){
    const hero=HEROES[state.hero]||HEROES.vanguard;for(const id of Object.keys(state.weapons))state.weapons[id]=0;let starter=hero.starter;
    if(hero.randomStarter){const pool=Object.keys(state.weapons);starter=pool[Math.floor(gameRandom()*pool.length)];state.stats.forge.holds=0;}
    if(starter)state.weapons[starter]=1;
    if(state.hero==='guardian'){state.stats.shieldMax=2;state.stats.shield=2;state.stats.shieldClock=8;}
    if(state.hero==='cursed'){
      state.difficulty.health*=1.3;state.difficulty.damage*=1.15;state.heroCursedApplied=true;const pool=bossRelics.filter(relic=>(!relic.when||relic.when())&&!state.relics[relic.id]),relic=pool[Math.floor(gameRandom()*pool.length)];if(relic){relic.apply();state.relics[relic.id]=1;state.startingBossRelic=relic.name;}
    }
  }
  function actorById(id){return coopActors.find(actor=>actor.id===id)||coopActors[0]||null;}
  function liveActors(){return coopActors.filter(actor=>actor.connected&&actor.stats.hp>0);}
  function withActor(actor,fn){
    if(!actor)return fn();
    if(coopNet.mode==='solo'&&actor.local){const result=fn();actor.entity=player;actor.stats=state.stats;actor.weapons=state.weapons;actor.cooldowns=state.cooldowns;actor.relics=state.relics;actor.buffs=state.buffs;actor.hero=state.hero;actor.hardcore=state.hardcore;actor.invuln=state.invuln;actor.pendingLevels=pendingLevels;actor.pendingChests=pendingChests;actor.currentChoices=currentChoices;actor.choiceKind=choiceKind;return result;}
    const saved={player,stats:state.stats,weapons:state.weapons,cooldowns:state.cooldowns,relics:state.relics,buffs:state.buffs,hero:state.hero,hardcore:state.hardcore,invuln:state.invuln,pendingLevels,pendingChests,currentChoices,choiceKind,activeActorId};
    player=actor.entity;state.stats=actor.stats;state.weapons=actor.weapons;state.cooldowns=actor.cooldowns;state.relics=actor.relics;state.buffs=actor.buffs;state.hero=actor.hero;state.hardcore=actor.hardcore;state.invuln=actor.invuln||0;pendingLevels=actor.pendingLevels;pendingChests=actor.pendingChests;currentChoices=actor.currentChoices;choiceKind=actor.choiceKind;activeActorId=actor.id;
    let result;try{result=fn();}finally{actor.entity=player;actor.stats=state.stats;actor.weapons=state.weapons;actor.cooldowns=state.cooldowns;actor.relics=state.relics;actor.buffs=state.buffs;actor.hero=state.hero;actor.hardcore=state.hardcore;actor.invuln=state.invuln;actor.pendingLevels=pendingLevels;actor.pendingChests=pendingChests;actor.currentChoices=currentChoices;actor.choiceKind=choiceKind;player=saved.player;state.stats=saved.stats;state.weapons=saved.weapons;state.cooldowns=saved.cooldowns;state.relics=saved.relics;state.buffs=saved.buffs;state.hero=saved.hero;state.hardcore=saved.hardcore;state.invuln=saved.invuln;pendingLevels=saved.pendingLevels;pendingChests=saved.pendingChests;currentChoices=saved.currentChoices;choiceKind=saved.choiceKind;activeActorId=saved.activeActorId;}
    return result;
  }

  const upgrades = [
    {id:'blaster',name:'Осколочный залп',icon:'✦',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>true,level:()=>state.weapons.blaster,desc:()=>state.weapons.blaster?'Больше урона и темпа. Каждый 4-й уровень даёт ещё снаряд.':'Открывает автонаводящийся осколочный залп.',apply:()=>state.weapons.blaster++},
    {id:'aura',name:'Нулевая аура',icon:'◉',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>true,level:()=>state.weapons.aura,desc:()=>state.weapons.aura?'Аура становится шире, быстрее и болезненнее.':'Периодически стирает врагов рядом с героем.',apply:()=>state.weapons.aura++},
    {id:'orbit',name:'Орбитальные клинки',icon:'⟲',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>true,level:()=>state.weapons.orbit,desc:()=>state.weapons.orbit?'Добавляет скорость, размер и новые клинки.':'Призывает два клинка, вращающихся вокруг героя.',apply:()=>state.weapons.orbit++},
    {id:'lightning',name:'Цепь молний',icon:'ϟ',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=3,level:()=>state.weapons.lightning,desc:()=>state.weapons.lightning?'Цепь прыгает дальше, чаще и с большим уроном.':'Молния автоматически скачет между целями.',apply:()=>state.weapons.lightning++},
    {id:'meteor',name:'Метеоритный дождь',icon:'☄',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=6,level:()=>state.weapons.meteor,desc:()=>state.weapons.meteor?'Больше метеоров, радиус и сила взрыва.':'Вызывает метеоры в самых плотных группах врагов.',apply:()=>state.weapons.meteor++},
    {id:'saw',name:'Пила разрыва',icon:'✺',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>state.stats.level>=2,level:()=>state.weapons.saw,desc:()=>state.weapons.saw?'Пила становится огромнее, сильнее и пробивает больше тел.':'Запускает тяжёлый вращающийся диск сквозь всю толпу.',apply:()=>state.weapons.saw++},
    {id:'frost',name:'Крио-импульс',icon:'❄',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>state.stats.level>=4,level:()=>state.weapons.frost,desc:()=>state.weapons.frost?'Увеличивает радиус, замедление и урон импульса.':'Замораживает и ранит всех врагов вокруг героя.',apply:()=>state.weapons.frost++},
    {id:'drone',name:'Дроны-охотники',icon:'⬡',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=5,level:()=>state.weapons.drone,desc:()=>state.weapons.drone?'Добавляет дронов, скорострельность и мощность.':'Боевые дроны вращаются вокруг героя и сами расстреливают цели.',apply:()=>state.weapons.drone++},
    {id:'gravity',name:'Гравитационный колодец',icon:'●',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=8,level:()=>state.weapons.gravity,desc:()=>state.weapons.gravity?'Колодец живёт дольше, становится шире и тянет сильнее. Урона не наносит.':'Создаёт в гуще врагов чёрную дыру, которая стягивает их, но не наносит урон.',apply:()=>state.weapons.gravity++},
    {id:'firetrail',name:'Огненный след',icon:'♨',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>state.stats.level>=3,level:()=>state.weapons.firetrail,desc:()=>state.weapons.firetrail?'След горит дольше, становится шире и наносит больше урона.':'Оставляет за героем полосу огня, сжигающую преследующую толпу.',apply:()=>state.weapons.firetrail++},
    {id:'riftlance',name:'Копьё Разлома',icon:'╾',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=4,level:()=>state.weapons.riftlance,desc:()=>state.weapons.riftlance?'Луч становится шире, сильнее и пробивает больше целей.':'Пронзает длинную линию врагов энергетическим копьём.',apply:()=>state.weapons.riftlance++},
    {id:'boomerang',name:'Призрачный бумеранг',icon:'☾',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>state.stats.level>=3,level:()=>state.weapons.boomerang,desc:()=>state.weapons.boomerang?'Серп становится крупнее, быстрее и опаснее на обратном пути.':'Запускает серп, способный ударить одну цель на пути туда и обратно.',apply:()=>state.weapons.boomerang++},
    {id:'prism',name:'Кристальный призматор',icon:'◈',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=6,level:()=>state.weapons.prism,desc:()=>state.weapons.prism?'Луч наносит больше урона и быстрее достигает полного резонанса.':'Удерживает луч на одной цели и усиливает его до +50%.',apply:()=>state.weapons.prism++},
    {id:'mines',name:'Минный фабрикатор',icon:'⊙',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>state.stats.level>=4,level:()=>state.weapons.mines,desc:()=>state.weapons.mines?'Увеличивает запас мин, радиус и силу взрыва.':'Оставляет позади героя мины, срабатывающие только рядом с врагом.',apply:()=>state.weapons.mines++},
    {id:'mortar',name:'Ионный миномёт',icon:'◒',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=7,level:()=>state.weapons.mortar,desc:()=>state.weapons.mortar?'Миномёт стреляет чаще, шире и больнее по плотным группам.':'Посылает навесной заряд в самую плотную группу врагов.',apply:()=>state.weapons.mortar++},
    {id:'chrononeedles',name:'Хроно-иглы',icon:'⇶',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>state.stats.level>=3,level:()=>state.weapons.chrononeedles,desc:()=>state.weapons.chrononeedles?'Добавляет иглы, урон и длительность накопленного замедления.':'Быстрые иглы складывают на цели замедление до 40%.',apply:()=>state.weapons.chrononeedles++},
    {id:'seismic',name:'Сейсмическое ядро',icon:'◎',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=6,level:()=>state.weapons.seismic,desc:()=>state.weapons.seismic?'Кольцо расширяется дальше, быстрее и наносит больше урона. На краю остаётся 50% урона.':'Выпускает отталкивающую наземную волну; урон плавно падает до 50% у края, боссов не отбрасывает.',apply:()=>state.weapons.seismic++},
    {id:'nanoswarm',name:'Нанорой',icon:'⁙',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=8,level:()=>state.weapons.nanoswarm,desc:()=>state.weapons.nanoswarm?'Добавляет жуков, атаки каждого жука и урон.':'Выпускает автономных жуков, предпочитающих опасные специальные цели.',apply:()=>state.weapons.nanoswarm++},
    {id:'mirrordisc',name:'Зеркальный диск',icon:'◐',type:'ОРУЖИЕ',rarity:'epic',max:8,when:()=>state.stats.level>=7,level:()=>state.weapons.mirrordisc,desc:()=>state.weapons.mirrordisc?'Диск чаще отражает снаряды и сильнее режет ближайших врагов.':'Вращается перед героем, ранит врагов и отражает редкие снаряды.',apply:()=>state.weapons.mirrordisc++},
    {id:'resonance',name:'Резонансный колокол',icon:'♢',type:'ОРУЖИЕ',rarity:'rare',max:8,when:()=>state.stats.level>=5,level:()=>state.weapons.resonance,desc:()=>state.weapons.resonance?'Импульс становится шире и сильнее; серия растёт до десяти зарядов.':'Каждый импульс усиливает следующий, а получение урона сбрасывает половину зарядов.',apply:()=>state.weapons.resonance++},
    {id:'power',name:'Неприличная сила',icon:'⚔',type:'ХАРАКТЕРИСТИКА',rarity:'common',max:10,desc:()=>'+18% базового урона героя за ранг. Бонус складывается аддитивно.',apply:()=>state.stats.damageMult+=state.stats.baseDamage*.18},
    {id:'haste',name:'Перегрузка',icon:'»',type:'ХАРАКТЕРИСТИКА',rarity:'common',max:10,desc:()=>'+12% скорости всех автоматических атак.',apply:()=>state.stats.fireRate*=1.12},
    {id:'multishot',name:'Двойная ставка',icon:'Ψ',type:'ХАРАКТЕРИСТИКА',rarity:'epic',max:5,desc:()=>'+1 снаряд обычному оружию. Тяжёлые дополнительные снаряды наносят 50% урона; лучи и молнии получают ослабленные дополнительные цели.',apply:()=>state.stats.projectiles++},
    {id:'crit',name:'Заточка вероятности',icon:'◇',type:'ХАРАКТЕРИСТИКА',rarity:'common',max:8,desc:()=>'+8% шанс критического удара и +12% крит-урона.',apply:()=>{state.stats.crit+=.08;state.stats.critMult+=.12}},
    {id:'pierce',name:'Законы не преграда',icon:'➤',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:6,desc:()=>'+1 пробитие для каждого снаряда.',apply:()=>state.stats.pierce++},
    {id:'vitality',name:'Запасное сердце',icon:'♥',type:'ВЫЖИВАНИЕ',rarity:'common',max:8,when:()=>!state.hardcore,desc:()=>'+30 максимального здоровья и немедленно лечит 30.',apply:()=>{if(!state.hardcore){state.stats.maxHp+=30;healPlayer(30)}}},
    {id:'armor',name:'Чугунная кожа',icon:'⬢',type:'ВЫЖИВАНИЕ',rarity:'common',max:7,desc:()=>'+8 брони. Урон уменьшается с убывающей отдачей.',apply:()=>state.stats.armor+=8},
    {id:'regen',name:'Наноремонт',icon:'✚',type:'ВЫЖИВАНИЕ',rarity:'rare',max:6,desc:()=>'+0.8 здоровья в секунду.',apply:()=>state.stats.regen+=.8},
    {id:'speed',name:'Ноги вне закона',icon:'➟',type:'ХАРАКТЕРИСТИКА',rarity:'common',max:7,desc:()=>'+12% скорости движения.',apply:()=>state.stats.speed*=1.12},
    {id:'magnet',name:'Жадный магнит',icon:'∪',type:'ХАРАКТЕРИСТИКА',rarity:'common',max:7,desc:()=>'+30% радиуса сбора опыта и +7% опыта.',apply:()=>{state.stats.pickup*=1.3;state.stats.xpMult+=.07}},
    {id:'size',name:'Некомпенсируемый калибр',icon:'●',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:6,desc:()=>'+15% размера снарядов и зон поражения.',apply:()=>state.stats.projSize*=1.15},
    {id:'velocity',name:'Гиперствол',icon:'↠',type:'ХАРАКТЕРИСТИКА',rarity:'common',max:8,desc:()=>'+18% скорости и +7% урона поддерживаемых летящих снарядов. Зоны и ауры не усиливает.',apply:()=>{state.stats.projSpeed*=1.18;state.stats.projectileDamage*=1.07}},
    {id:'duration',name:'Растяжитель секунды',icon:'⌛',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:6,desc:()=>'+5% длительности зон, расходников и особых атак.',apply:()=>state.stats.duration*=1.05},
    {id:'lifesteal',name:'Вампирский контур',icon:'♢',type:'ВЫЖИВАНИЕ',rarity:'epic',max:5,desc:()=>'+0.15% вампиризма от всего урона.',apply:()=>state.stats.lifesteal+=.0015},
    {id:'shield',name:'Перезапускаемый щит',icon:'▣',type:'ВЫЖИВАНИЕ',rarity:'rare',max:4,desc:()=>'+1 заряд щита. Заряды восстанавливаются вне урона.',apply:()=>{state.stats.shieldMax++;state.stats.shield=state.stats.shieldMax}},
    {id:'scavenger',name:'Карманный мародёр',icon:'♧',type:'РЕЛИКВИЯ',rarity:'rare',max:6,desc:()=>'+1% к шансу выпадения расходников и +5% опыта.',apply:()=>{state.stats.dropLuck+=.01;state.stats.xpMult+=.05}},
    {id:'killNova',name:'Реактор бойни',icon:'⊛',type:'РЕЛИКВИЯ',rarity:'epic',max:5,desc:()=> 'Каждая серия из убийств вызывает бесплатный взрыв вокруг героя. Следующие ранги сокращают серию и усиливают взрыв.',apply:()=>state.stats.killNova++},
    {id:'corpseFire',name:'Пепел к пеплу',icon:'♨',type:'РЕЛИКВИЯ',rarity:'epic',max:5,desc:()=>'+10% шанс за ранг оставить горящую лужу на месте убитого врага.',apply:()=>state.stats.corpseFire++},
    {id:'desperation',name:'Красная зона',icon:'▼',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:5,desc:()=>'+12% урона за ранг при полностью потерянном здоровье; эффект плавный.',apply:()=>state.stats.desperation++},
    {id:'chainBonus',name:'Разветвитель дуги',icon:'ϟ+',type:'РЕЛИКВИЯ',rarity:'epic',max:5,desc:()=>'+1 прыжок цепной молнии за ранг.',apply:()=>state.stats.chainBonus++},
    {id:'bossSlayer',name:'Калибратор титанов',icon:'♛',type:'РЕЛИКВИЯ',rarity:'rare',max:5,desc:()=>'+15% урона боссам за ранг.',apply:()=>state.stats.bossSlayer++},
    {id:'crowdPower',name:'Давление толпы',icon:'☷',type:'ЛОМАЕТ ИГРУ',rarity:'legendary',max:5,desc:()=>'+10% урона за ранг, когда на арене больше 100 живых врагов.',apply:()=>state.stats.crowdPower++},
    {id:'levelHeal',name:'Эволюционный ремонт',icon:'↟',type:'ВЫЖИВАНИЕ',rarity:'common',max:5,desc:()=> 'Каждый новый уровень восстанавливает 3% здоровья за ранг.',apply:()=>state.stats.levelHeal++},
    {id:'burnPower',name:'Белый фосфор',icon:'△',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:6,desc:()=>'+20% урона огненного следа и горящих луж.',apply:()=>state.stats.burnPower++},
    {id:'revive',name:'Запасная реальность',icon:'Ⅱ',type:'РЕЛИКВИЯ',rarity:'legendary',max:2,desc:()=> 'Один раз отменяет смерть, лечит 60% здоровья и даёт бессмертие.',apply:()=>state.stats.revives++},
    {id:'execute',name:'Последний аргумент',icon:'☠',type:'РЕЛИКВИЯ',rarity:'epic',max:4,desc:()=>'+8% порог мгновенной казни обычного врага. На боссов не действует.',apply:()=>state.stats.execute+=.08},
    {id:'thorns',name:'Ответный BONK',icon:'♜',type:'РЕЛИКВИЯ',rarity:'rare',max:5,desc:()=>'+35 урона врагам, коснувшимся героя.',apply:()=>state.stats.thorns+=35},
    {id:'echo',name:'Двигатель эха',icon:'∞',type:'ЛОМАЕТ ИГРУ',rarity:'legendary',max:5,desc:()=>'+18% шанс продублировать атаку любого текущего или будущего оружия. Вместе с другими источниками шанс выше 100% всё ещё создаёт гарантированные копии.',apply:()=>state.stats.echo+=.18},
    {id:'criticalMass',name:'Критическая масса',icon:'✹',type:'ЛОМАЕТ ИГРУ',rarity:'legendary',max:4,desc:()=> 'Крит создаёт взрыв: 7% + 3% за ранг от фактически снятого HP. Оверкилл не усиливает взрыв.',apply:()=>state.stats.critExplosion++},
    {id:'feedback',name:'Петля обратной связи',icon:'↻',type:'ЛОМАЕТ ИГРУ',rarity:'legendary',max:5,desc:()=> 'Убийства сокращают текущие перезарядки, но общий выигрыш ограничен за каждую секунду. Толпа остаётся топливом без бесконечной петли.',apply:()=>state.stats.feedback++},
    {id:'blood',name:'Кровавая батарея',icon:'♦',type:'ЛОМАЕТ ИГРУ',rarity:'legendary',max:4,desc:()=> 'Каждые 200 убийств лечат и добавляют +2% базового урона за ранг. Суммарный бонус ограничен +200% базы.',apply:()=>state.stats.blood++},
    {id:'levelPower',name:'Корона экспоненты',icon:'♛',type:'ЛОМАЕТ ИГРУ',rarity:'legendary',max:3,desc:()=> 'Каждый следующий рубеж в 5 уровней добавляет +2% базового урона за ранг. Прошлые рубежи не пересчитываются.',apply:()=>state.stats.levelPower++},
    {id:'glassReactor',name:'Стеклянный реактор',icon:'◊',type:'РИСК',rarity:'epic',max:5,when:()=>!state.hardcore,desc:()=>'+12% базового урона, но −8% максимального здоровья за ранг.',apply:()=>{state.stats.damageMult+=state.stats.baseDamage*.12;state.stats.maxHp=Math.max(1,state.stats.maxHp*.92);state.stats.hp=Math.min(state.stats.hp,state.stats.maxHp)}},
    {id:'inertiaFlywheel',name:'Инерционный маховик',icon:'⟳',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:5,desc:()=>'+12% темпа атак за ранг после разгона в движении; стоя бонус быстро исчезает.',apply:()=>state.stats.inertiaFlywheel++},
    {id:'hunterAnchor',name:'Якорь охотника',icon:'⚓',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:4,desc:()=> 'После 2 секунд неподвижности: +8% урона и +6% размера атак за ранг. Долгая стоянка повышает ответное давление Разлома.',apply:()=>state.stats.hunterAnchor++},
    {id:'thermoSiphon',name:'Термосифон',icon:'♨+',type:'РЕЛИКВИЯ',rarity:'epic',max:4,desc:()=> 'Горящие враги получают +5% урона за ранг от других источников; лечение от горящих убийств не чаще раза в секунду.',apply:()=>state.stats.thermoSiphon++},
    {id:'dischargeCap',name:'Разрядный конденсатор',icon:'ϟ◫',type:'РЕЛИКВИЯ',rarity:'epic',max:6,desc:()=> 'Каждое 25-е попадание вызывает дополнительную цепную молнию; ранг уменьшает порог на 2, минимум 15.',apply:()=>state.stats.dischargeCap++},
    {id:'cryoCapillary',name:'Криокапилляр',icon:'❄+',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:4,desc:()=>'+4% урона за ранг по замедленным врагам; на боссах эффект вдвое слабее.',apply:()=>state.stats.cryoCapillary++},
    {id:'emergencyTeleport',name:'Аварийный телепорт',icon:'⌁',type:'ВЫЖИВАНИЕ',rarity:'legendary',max:4,desc:()=> 'Ниже 20% HP переносит героя от опасности. Перезарядка 45 секунд, −5 секунд за следующий ранг.',apply:()=>state.stats.emergencyTeleport++},
    {id:'pocketForge',name:'Карманная кузница',icon:'⚒',type:'РЕЛИКВИЯ',rarity:'epic',max:3,desc:()=> 'Каждый 5-й уровень временно даёт +1 уровень случайному оружию за ранг до следующего уровня. Эволюцию не создаёт.',apply:()=>state.stats.pocketForge++},
    {id:'shardAccumulator',name:'Осколочный накопитель',icon:'✧',type:'РЕЛИКВИЯ',rarity:'epic',max:4,desc:()=> 'Неизрасходованное пробитие копится. Каждые 20 единиц выпускают круговой залп; ранг усиливает его.',apply:()=>state.stats.shardAccumulator++},
    {id:'blackPowder',name:'Чёрный порох',icon:'✹',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:4,desc:()=>'+15% урона по площади, но −6% радиуса зон за ранг.',apply:()=>state.stats.blackPowder++},
    {id:'riftStabilizer',name:'Стабилизатор Разлома',icon:'⌛+',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:5,desc:()=>'+8% длительности постоянных зон, но −5% частоты их создания за ранг.',apply:()=>state.stats.riftStabilizer++},
    {id:'gildedLure',name:'Позолоченная приманка',icon:'♧',type:'РИСК',rarity:'legendary',max:1,desc:()=>'+1 процентный пункт к выпадению расходников; новые элиты получают +8% здоровья. Общий предел остаётся 2%.',apply:()=>{state.stats.dropLuck+=1/CONSUMABLE_BASE_CHANCE/100;state.stats.gildedLure=1}},
    {id:'soulCollector',name:'Сборщик душ',icon:'♛◌',type:'РЕЛИКВИЯ',rarity:'epic',max:3,desc:()=> 'Элиты дают заряды душ. Каждый заряд: +0,5% урона боссам, максимум 30; убийство босса сбрасывает запас.',apply:()=>state.stats.soulCollector++},
    {id:'reversedClock',name:'Перевёрнутые часы',icon:'↶',type:'ХАРАКТЕРИСТИКА',rarity:'rare',max:4,desc:()=> 'Временные расходники действуют на 8% дольше, но их сила уменьшается на 3% за ранг.',apply:()=>state.stats.reversedClock++},
    {id:'pursuitMark',name:'Метка преследования',icon:'⌖',type:'ХАРАКТЕРИСТИКА',rarity:'epic',max:3,desc:()=> 'Непрерывный урон одной цели разгоняется до +20%. Ранги ускоряют разгон; смена цели сбрасывает бонус.',apply:()=>state.stats.pursuitMark++},
    {id:'unstableDuplicator',name:'Нестабильный дубликатор',icon:'Ⅱ?',type:'ЛОМАЕТ ИГРУ',rarity:'legendary',max:5,desc:()=>'+4% шанс за ранг повторить попадание с 60% силы. Повтор не может запустить сам себя.',apply:()=>state.stats.unstableDuplicator++},
    {id:'bloodContract',name:'Кровавый контракт',icon:'♥◇',type:'РИСК',rarity:'legendary',max:1,desc:()=> 'При полном HP: +10% урона. Ниже 50% HP вместо этого: +12% скорости движения.',apply:()=>state.stats.bloodContract=1},
    {id:'cleanupProtocol',name:'Протокол зачистки',icon:'☷✓',type:'РЕЛИКВИЯ',rarity:'epic',max:4,desc:()=> 'Убийство специального врага даёт +2% темпа атак за ранг на 4 секунды, до 5 зарядов.',apply:()=>state.stats.cleanupProtocol++}
  ];

  const bossRelics = [
    {id:'bossRiftHeart',name:'Сердце Разлома',icon:'♥',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,when:()=>!state.hardcore,desc:()=>'+60 максимального здоровья, полное лечение и +1.5 регенерации.',apply:()=>{state.stats.maxHp+=60;healPlayer(state.stats.maxHp);state.stats.regen+=1.5}},
    {id:'bossBlackMirror',name:'Чёрное зеркало',icon:'◇',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+35% глобального эха для текущего и будущего оружия.',apply:()=>state.stats.echo+=.35},
    {id:'bossWarArchive',name:'Архив войны',icon:'Ψ',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+2 снаряда всем поддерживаемым семействам оружия, +3 пробития и +20% скорости снарядов.',apply:()=>{state.stats.projectiles+=2;state.stats.pierce+=3;state.stats.projSpeed*=1.2}},
    {id:'bossVoidFang',name:'Клык пустоты',icon:'☠',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+1.2% вампиризма и казнь обычных врагов ниже 12% здоровья. На боссов не действует.',apply:()=>{state.stats.lifesteal+=.012;state.stats.execute+=.12}},
    {id:'bossChronocore',name:'Хроноядро',icon:'⌛',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+30% темпа атак и +10% скорости движения.',apply:()=>{state.stats.fireRate*=1.3;state.stats.speed*=1.1}},
    {id:'bossGiantLens',name:'Линза исполина',icon:'●',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+25% размера атак и +20% длительности зон.',apply:()=>{state.stats.projSize*=1.25;state.stats.duration*=1.2}},
    {id:'bossPhoenix',name:'Пепельный феникс',icon:'Ⅱ',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+1 возрождение и +2 здоровья в секунду.',apply:()=>{state.stats.revives++;state.stats.regen+=2}},
    {id:'bossTitanSeal',name:'Печать титана',icon:'♛',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+35% базового урона и +30% урона боссам.',apply:()=>{state.stats.damageMult+=state.stats.baseDamage*.35;state.stats.bossSlayer+=2}},
    {id:'bossAbyssMagnet',name:'Голодная сингулярность',icon:'∪',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=> 'Радиус сбора ×2, +25% опыта и +15% выпадения расходников.',apply:()=>{state.stats.pickup*=2;state.stats.xpMult+=.25;state.stats.dropLuck+=.15}},
    {id:'bossIronOath',name:'Железная клятва',icon:'▣',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+40 брони и два восстанавливаемых заряда щита.',apply:()=>{state.stats.armor+=40;state.stats.shieldMax+=2;state.stats.shield=state.stats.shieldMax}},
    {id:'bossBloodMoon',name:'Кровавая луна',icon:'✹',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+20% шанса крита и +60% критического урона.',apply:()=>{state.stats.crit+=.20;state.stats.critMult+=.6}},
    {id:'bossSwarmCrown',name:'Корона легиона',icon:'☷',type:'РЕЛИКВИЯ БОССА',rarity:'boss',max:1,desc:()=>'+30% урона при большой толпе и +15% выпадения расходников.',apply:()=>{state.stats.crowdPower+=3;state.stats.dropLuck+=.15}}
  ];

  const evolutionUpgrades = [
    {id:'evoBlaster',weapon:'blaster',requires:'multishot',name:'ОМЕГА-ЗАЛП',icon:'✦✦',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Осколочный залп получает ещё два снаряда, огромный калибр и взрывной урон.'},
    {id:'evoAura',weapon:'aura',requires:'size',name:'ГОРИЗОНТ СОБЫТИЙ',icon:'◉',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Нулевая аура становится значительно шире, сильнее и срабатывает на 55% чаще.'},
    {id:'evoOrbit',weapon:'orbit',requires:'duration',name:'КОРОНА МЯСОРУБКИ',icon:'⟲',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Три дополнительных клинка вращаются дальше и быстрее, нанося на 70% больше урона.'},
    {id:'evoLightning',weapon:'lightning',requires:'chainBonus',name:'ВЕЧНАЯ ГРОЗА',icon:'ϟ',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Цепная молния оставляет длительные грозовые зоны, непрерывно поражающие толпу.'},
    {id:'evoMeteor',weapon:'meteor',requires:'criticalMass',name:'АПОКАЛИПСИС',icon:'☄',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Дополнительная цель, крупные взрывы и +70% урона каждого метеорита.'},
    {id:'evoSaw',weapon:'saw',requires:'pierce',name:'МЯСОРУБКА РАЗЛОМА',icon:'✺',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Пилы становятся крупнее, живут дольше, получают +24 пробития и один дополнительный диск.'},
    {id:'evoFrost',weapon:'frost',requires:'duration',name:'АБСОЛЮТНЫЙ НОЛЬ',icon:'❄',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Крио-импульс покрывает большую область, наносит больше урона и замедляет на 82%.'},
    {id:'evoDrone',weapon:'drone',requires:'haste',name:'РОЙ СИНГУЛЯРНОСТИ',icon:'⬡',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Количество дронов увеличивается примерно в полтора раза, а боеприпасы становятся сильнее и пробивают цели.'},
    {id:'evoGravity',weapon:'gravity',requires:'size',name:'ЧЁРНОЕ СОЛНЦЕ',icon:'●',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Колодец превращается в огромное чёрное солнце с усиленной в 1,8 раза тягой. Сам по себе урона не наносит.'},
    {id:'evoFiretrail',weapon:'firetrail',requires:'burnPower',name:'ОГНЕННЫЙ ШТОРМ',icon:'♨',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Три широких огненных следа живут дольше и сжигают преследующую армию.'},
    {id:'evoRiftlance',weapon:'riftlance',requires:'shardAccumulator',name:'ПРОКОЛ РЕАЛЬНОСТИ',icon:'╾∞',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Копьё оставляет вдоль луча длительные повреждающие разломы.'},
    {id:'evoBoomerang',weapon:'boomerang',requires:'inertiaFlywheel',name:'ЖНЕЦ ОРБИТЫ',icon:'☾☾',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Три огромных серпа расходятся веером и возвращаются с повышенной силой.'},
    {id:'evoPrism',weapon:'prism',requires:'pursuitMark',name:'СВЕРХНОВАЯ ПРИЗМА',icon:'◈ϟ',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Основной луч раскалывается ещё на три соседние цели.'},
    {id:'evoMines',weapon:'mines',requires:'blackPowder',name:'НУЛЕВАЯ ТЕРРИТОРИЯ',icon:'⊙―⊙',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Активные мины соединяются линиями, режущими проходящих врагов.'},
    {id:'evoMortar',weapon:'mortar',requires:'riftStabilizer',name:'ОРБИТАЛЬНАЯ АРТИЛЛЕРИЯ',icon:'◒×4',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Каждый залп превращается в серию из четырёх ионных попаданий.'},
    {id:'evoChrononeedles',weapon:'chrononeedles',requires:'cryoCapillary',name:'ОСТАНОВКА ВРЕМЕНИ',icon:'⇶⌛',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Максимум накопленных игл ненадолго почти полностью останавливает цель.'},
    {id:'evoSeismic',weapon:'seismic',requires:'hunterAnchor',name:'ПЛАНЕТАРНЫЙ РАСКОЛ',icon:'◎◎◎',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'После первой волны расходятся ещё два последовательных кольца.'},
    {id:'evoNanoswarm',weapon:'nanoswarm',requires:'cleanupProtocol',name:'СЕРЫЙ МОР',icon:'⁙∞',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Убивший цель нанорой может создать нового жука; численность имеет безопасный предел.'},
    {id:'evoMirrorDisc',weapon:'mirrordisc',requires:'emergencyTeleport',name:'АБСОЛЮТНОЕ ЗЕРКАЛО',icon:'◐Ψ',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Каждый отражённый снаряд разделяется на три дружественных.'},
    {id:'evoResonance',weapon:'resonance',requires:'bloodContract',name:'ПОСЛЕДНИЙ ЗВОН',icon:'♢X',type:'ЭВОЛЮЦИЯ',rarity:'evolved',max:1,desc:()=> 'Десятый импульс создаёт дополнительную огромную ударную волну.'}
  ].map(evolution=>({...evolution,when:()=>state.weapons[evolution.weapon]>=8&&upCount(evolution.requires)>0&&!upCount(evolution.id),apply:()=>{}}));

  function applyRiftResonanceCost(){
    const health=1.015,speed=1.005;state.difficulty.health*=health;state.difficulty.speed*=speed;state.stats.riftResonanceChoices=(state.stats.riftResonanceChoices||0)+1;
    for(const enemy of enemies){if(enemy.dead)continue;enemy.hp*=health;enemy.maxHp*=health;enemy.speed*=speed;}
    updateUI(true);
  }
  function applyRandomWeaponResonance(){
    const candidates=equippedWeaponIds().filter(id=>id!=='gravity'||state.hero==='voidwalker'),id=candidates[Math.floor(gameRandom()*candidates.length)];
    if(id){const bonuses=state.stats.riftWeaponPower||(state.stats.riftWeaponPower={});bonuses[id]=(bonuses[id]||0)+.015;state.stats.riftLastWeapon=id;}
    applyRiftResonanceCost();
  }
  const riftResonanceUpgrades = [
    {id:'riftPower',name:'Отголосок силы',icon:'✦',type:'РЕЗОНАНС РАЗЛОМА',rarity:'rift',max:9999,desc:()=>'+1,5% базового урона. Цена резонанса: враги получают +1,5% здоровья и +0,5% скорости.',preview:[['БАЗОВЫЙ УРОН','+1,5%'],['ЗДОРОВЬЕ ВРАГОВ','+1,5%'],['СКОРОСТЬ ВРАГОВ','+0,5%']],apply:()=>{state.stats.damageMult+=state.stats.baseDamage*.015;applyRiftResonanceCost()}},
    {id:'riftHaste',name:'Пульс Разлома',icon:'ϟ',type:'РЕЗОНАНС РАЗЛОМА',rarity:'rift',max:9999,desc:()=>'+1% темпа атак. Цена резонанса: враги получают +1,5% здоровья и +0,5% скорости.',preview:[['ТЕМП АТАК','+1%'],['ЗДОРОВЬЕ ВРАГОВ','+1,5%'],['СКОРОСТЬ ВРАГОВ','+0,5%']],apply:()=>{state.stats.fireRate*=1.01;applyRiftResonanceCost()}},
    {id:'riftSize',name:'Раздвижение граней',icon:'●',type:'РЕЗОНАНС РАЗЛОМА',rarity:'rift',max:9999,desc:()=>'+1,5% размера атак. Цена резонанса: враги получают +1,5% здоровья и +0,5% скорости.',preview:[['РАЗМЕР АТАК','+1,5%'],['ЗДОРОВЬЕ ВРАГОВ','+1,5%'],['СКОРОСТЬ ВРАГОВ','+0,5%']],apply:()=>{state.stats.projSize*=1.015;applyRiftResonanceCost()}},
    {id:'riftDuration',name:'Застывшее эхо',icon:'⌛',type:'РЕЗОНАНС РАЗЛОМА',rarity:'rift',max:9999,desc:()=>'+1% длительности эффектов. Цена резонанса: враги получают +1,5% здоровья и +0,5% скорости.',preview:[['ДЛИТЕЛЬНОСТЬ','+1%'],['ЗДОРОВЬЕ ВРАГОВ','+1,5%'],['СКОРОСТЬ ВРАГОВ','+0,5%']],apply:()=>{state.stats.duration*=1.01;applyRiftResonanceCost()}},
    {id:'riftVitality',name:'Упрямая материя',icon:'♥',type:'РЕЗОНАНС РАЗЛОМА',rarity:'rift',max:9999,when:()=>!state.hardcore,desc:()=>'+1% максимального здоровья и +0,5 брони. Цена резонанса: враги получают +1,5% здоровья и +0,5% скорости.',preview:[['МАКСИМАЛЬНОЕ HP','+1%'],['БРОНЯ','+0,5'],['ЗДОРОВЬЕ ВРАГОВ','+1,5%'],['СКОРОСТЬ ВРАГОВ','+0,5%']],apply:()=>{const ratio=state.stats.hp/Math.max(1,state.stats.maxHp);state.stats.maxHp*=1.01;state.stats.hp=state.stats.maxHp*ratio;state.stats.armor+=.5;applyRiftResonanceCost()}},
    {id:'riftWeapon',name:'Эхо арсенала',icon:'◈',type:'РЕЗОНАНС РАЗЛОМА',rarity:'rift',max:9999,desc:()=>'+1,5% урона случайного экипированного оружия. Цена резонанса: враги получают +1,5% здоровья и +0,5% скорости.',preview:[['СЛУЧАЙНОЕ ОРУЖИЕ','+1,5% урона'],['ЗДОРОВЬЕ ВРАГОВ','+1,5%'],['СКОРОСТЬ ВРАГОВ','+0,5%']],apply:applyRandomWeaponResonance}
  ];

  const CODEX_EVOLUTION_STATS = {
    evoBlaster:['+2 снаряда','Урон ×1,65','+3 пробития','Калибр ×1,40'],
    evoAura:['Частота ×1,55','Радиус ×1,45','Урон ×1,60'],
    evoOrbit:['+3 клинка','Радиус орбиты ×1,15','Скорость ×1,18','Урон ×1,70','Интервал по цели 0,14 сек'],
    evoLightning:['+3 прыжка','Урон молнии ×1,35','Грозовая зона: радиус 2,5','Зона живёт 4 сек','Тик зоны каждые 0,34 сек'],
    evoMeteor:['+1 метеор','Радиус ×1,40','Урон ×1,70'],
    evoSaw:['+1 пила','Урон ×1,75','+24 пробития','Калибр ×1,35','Длительность ×1,35'],
    evoFrost:['Радиус ×1,40','Урон ×1,45','Длительность ×1,45','Замедление 82%'],
    evoDrone:['Количество дронов примерно ×1,50','Урон ×1,55','+2 пробития','Калибр ×1,20'],
    evoGravity:['Урон по-прежнему 0','Длительность ×1,35','Радиус ×1,45','Притяжение ×1,80'],
    evoFiretrail:['3 параллельных следа','Длительность ×1,40','Радиус ×1,35','Урон ×1,75'],
    evoRiftlance:['6 разломов вдоль луча','Разлом живёт 1,8 сек','Радиус 0,85 + 0,035 × L','Урон тика 4,5 + 1,5 × L','Тик каждые 0,34 сек'],
    evoBoomerang:['3 серпа веером','Обратный урон ×1,25','Калибр ×1,18'],
    evoPrism:['3 дополнительные цели','Боковые лучи: 45% урона'],
    evoMines:['+2 к максимуму мин','Связи наносят 18% урона мины','Тик связей каждые 0,42 сек'],
    evoMortar:['4 попадания в серии','Каждое попадание: 68% урона'],
    evoChrononeedles:['Срабатывает на 10 зарядах','Замедление цели 96%','Длительность остановки 0,75 сек'],
    evoSeismic:['3 последовательных кольца','Урон колец: 100% / 82% / 64%'],
    evoNanoswarm:['35% шанс создать жука после убийства','Безопасный предел роя: 20 жуков'],
    evoMirrorDisc:['Каждое отражение делится на 3','Перезарядка отражения ×0,65'],
    evoResonance:['Срабатывает на 10-м импульсе','Дополнительный радиус ×1,50','Дополнительный урон ×1,80','После срабатывания заряды сбрасываются']
  };
  const CODEX_ITEM_IMPACTS = {
    power:['Базовый урон'],haste:['Темп атак'],multishot:['Снаряды'],crit:['Шанс крита','Критический урон'],pierce:['Пробитие'],vitality:['Максимальное HP','Лечение'],armor:['Броня'],regen:['Регенерация'],speed:['Скорость движения'],magnet:['Радиус сбора','Опыт'],size:['Калибр','Радиус зон'],velocity:['Скорость снарядов','Урон'],duration:['Длительность зон'],lifesteal:['Вампиризм'],shield:['Заряды щита'],scavenger:['Расходники'],killNova:['Убийства','Урон по площади'],corpseFire:['Убийства','Горение'],desperation:['Потерянное HP','Урон'],chainBonus:['Цепь молний'],bossSlayer:['Урон боссам'],crowdPower:['Размер толпы','Урон'],levelHeal:['Лечение при уровне'],burnPower:['Огненный урон'],revive:['Возрождение'],execute:['Казнь обычных врагов'],thorns:['Ответный урон'],echo:['Дублирование атак'],criticalMass:['Криты','Взрыв по площади'],feedback:['Убийства','Перезарядка'],blood:['Убийства','Базовый урон','Лечение'],levelPower:['Контрольные уровни','Базовый урон'],glassReactor:['Урон','Максимальное HP'],inertiaFlywheel:['Движение','Темп атак'],hunterAnchor:['Неподвижность','Урон','Калибр'],thermoSiphon:['Горение','Урон','Лечение'],dischargeCap:['Попадания','Цепная молния'],cryoCapillary:['Замедление','Урон'],emergencyTeleport:['Выживание','Телепортация'],pocketForge:['Контрольные уровни','Уровень оружия'],shardAccumulator:['Пробитие','Круговой залп'],blackPowder:['Урон по площади','Радиус зон'],riftStabilizer:['Длительность зон','Частота зон'],gildedLure:['Расходники','Здоровье элит'],soulCollector:['Элиты','Урон боссам'],reversedClock:['Расходники','Длительность','Сила эффекта'],pursuitMark:['Одна цель','Урон'],unstableDuplicator:['Повтор попадания','Урон'],bloodContract:['Текущее HP','Урон','Скорость движения'],cleanupProtocol:['Особые враги','Темп атак'],
    bossRiftHeart:['Максимальное HP','Лечение','Регенерация'],bossBlackMirror:['Дублирование атак'],bossWarArchive:['Снаряды','Пробитие','Скорость снарядов'],bossVoidFang:['Вампиризм','Казнь'],bossChronocore:['Темп атак','Скорость движения'],bossGiantLens:['Калибр','Длительность зон'],bossPhoenix:['Возрождение','Регенерация'],bossTitanSeal:['Базовый урон','Урон боссам'],bossAbyssMagnet:['Радиус сбора','Опыт','Расходники'],bossIronOath:['Броня','Щиты'],bossBloodMoon:['Шанс крита','Критический урон'],bossSwarmCrown:['Размер толпы','Урон','Расходники']
  };
  const CODEX_ITEM_NOTES = {
    power:'Добавка считается от базового урона героя, а не от уже разогнанного текущего значения.',
    multishot:'Полный бонус получают обычные снаряды, пилы, бумеранги и отражения. Дополнительные метеоры, миномётные заряды и лучи наносят 50% урона; дополнительные начальные молнии — 55%. Мины, саммоны и постоянные зоны не дублируются.',
    pierce:'Пробитие больше не повышает урон: оно только увеличивает число целей, через которые способен пройти снаряд.',
    velocity:'Бонус урона применяется отдельным множителем только к поддерживаемым летящим снарядам. Ауры, постоянные зоны и контактные атаки его не получают.',
    duration:'Каждый ранг даёт 5% длительности. Эффект влияет и на Огненный след.',
    blood:'Прогресс выдаётся за каждые 200 убийств. Прибавка урона считается от базового урона героя.',
    levelPower:'Бонус считается только по достигнутым контрольным уровням — один раз за каждые 5 уровней.',
    execute:'Казнь не действует на боссов.',
    echo:'Эхо применяется и к оружию, которое будет найдено после получения предмета.',
    gildedLure:'Глобальный итоговый шанс расходников всё равно ограничен пределом 2%.',
    bossBlackMirror:'Глобальное эхо применяется и к будущему оружию.',
    bossVoidFang:'Казнь действует только на обычных и специальных врагов, но не на боссов.',
    bossAbyssMagnet:'Глобальный итоговый шанс расходников ограничен пределом 2%.',
    bossSwarmCrown:'Глобальный итоговый шанс расходников ограничен пределом 2%.'
  };

  const endlessTotems = [
    {id:'endlessLegion',name:'Тотем бесконечного легиона',icon:'☷∞',type:'ФИНАЛЬНЫЙ ТОТЕМ',rarity:'cursed',max:9,desc:()=>'+60% врагов, +45% здоровья и +25% урона. Опыт +5%; шанс расходников не меняется.',apply:()=>applyDifficulty({spawn:1.6,health:1.45,damage:1.25,reward:1.05})},
    {id:'endlessVelocity',name:'Тотем сверхсветовой охоты',icon:'➟∞',type:'ФИНАЛЬНЫЙ ТОТЕМ',rarity:'cursed',max:9,desc:()=>'+45% скорости и +35% урона врагов. Опыт +4,5%; шанс расходников не меняется.',apply:()=>applyDifficulty({speed:1.45,damage:1.35,reward:1.045})},
    {id:'endlessTitans',name:'Тотем царства титанов',icon:'♛∞',type:'ФИНАЛЬНЫЙ ТОТЕМ',rarity:'cursed',max:6,desc:()=>'+1 копия боссов и +100% здоровья боссов. Опыт +3,5%; шанс расходников не меняется.',apply:()=>{state.difficulty.bosses++;state.difficulty.bossHealth*=2;state.difficulty.reward*=1.035}},
    {id:'endlessCollapse',name:'Тотем коллапса реальности',icon:'✹∞',type:'ФИНАЛЬНЫЙ ТОТЕМ',rarity:'cursed',max:6,desc:()=>'+35% ко всем параметрам врагов и количеству. Опыт +7,5%; шанс расходников не меняется.',apply:()=>applyDifficulty({spawn:1.35,health:1.35,damage:1.35,speed:1.35,reward:1.075})}
  ];

  const totemUpgrades = [
    {id:'hordeTotem',name:'Тотем легиона',icon:'☷',type:'ТОТЕМ СЛОЖНОСТИ',rarity:'cursed',max:6,desc:()=>'+35% врагов, +10% здоровья и +5% урона врагов. Опыт +1,2%; шанс расходников не меняется.',apply:()=>applyDifficulty({spawn:1.35,health:1.10,damage:1.05,reward:1.012})},
    {id:'ironTotem',name:'Тотем исполинов',icon:'♥',type:'ТОТЕМ СЛОЖНОСТИ',rarity:'cursed',max:6,desc:()=>'+40% здоровья и +8% урона врагов. Опыт +1,5%; шанс расходников не меняется.',apply:()=>applyDifficulty({health:1.40,damage:1.08,reward:1.015})},
    {id:'wrathTotem',name:'Тотем ярости',icon:'⚔',type:'ТОТЕМ СЛОЖНОСТИ',rarity:'cursed',max:6,desc:()=>'+30% урона и +10% скорости врагов. Опыт +1,4%; шанс расходников не меняется.',apply:()=>applyDifficulty({damage:1.30,speed:1.10,reward:1.014})},
    {id:'twinTotem',name:'Тотем двойной бездны',icon:'♛♛',type:'ТОТЕМ БОССОВ',rarity:'cursed',max:3,desc:()=>'+1 копия каждого будущего босса. Каждый дубликат даёт свой сундук. Опыт +1,2%.',apply:()=>{state.difficulty.bosses++;state.difficulty.reward*=1.012}},
    {id:'stormTotem',name:'Тотем красной бури',icon:'✹',type:'ТОТЕМ СЛОЖНОСТИ',rarity:'cursed',max:6,desc:()=>'+20% врагов, +20% здоровья и +20% урона. Опыт +2,5%; шанс расходников не меняется.',apply:()=>applyDifficulty({spawn:1.20,health:1.20,damage:1.20,reward:1.025})},
    {id:'hasteTotem',name:'Тотем охоты',icon:'➟',type:'ТОТЕМ СЛОЖНОСТИ',rarity:'cursed',max:6,desc:()=>'+25% скорости и +15% количества врагов. Опыт +1,6%; шанс расходников не меняется.',apply:()=>applyDifficulty({speed:1.25,spawn:1.15,reward:1.016})}
  ];
  const upCount = id => state.relics[id]||0;
  // Narrow upgrades should only enter the level-up pool after the build has a
  // real way to use them. Universal stats deliberately have no rule here.
  const ITEM_UNLOCK_RULES = {
    multishot:{weapons:['blaster','lightning','meteor','saw','riftlance','boomerang','prism','mortar','chrononeedles','mirrordisc']},
    velocity:{weapons:['blaster','meteor','saw','drone','riftlance','boomerang','prism','mortar','chrononeedles','nanoswarm']},
    pierce:{weapons:['blaster','saw','riftlance','boomerang']},
    chainBonus:{weapons:['lightning']},
    burnPower:{weapons:['firetrail'],items:['corpseFire']},
    thermoSiphon:{weapons:['firetrail'],items:['corpseFire']},
    cryoCapillary:{weapons:['frost','chrononeedles']},
    shardAccumulator:{weapons:['blaster','saw','drone','riftlance','boomerang','chrononeedles','nanoswarm']},
    blackPowder:{weapons:['aura','meteor','frost','firetrail','mines','mortar','seismic','resonance'],items:['corpseFire','killNova','criticalMass'],evolutions:['evoLightning','evoRiftlance']},
    riftStabilizer:{weapons:['aura','meteor','frost','gravity','firetrail','mines','mortar','seismic','resonance'],evolutions:['evoLightning','evoRiftlance']}
  };
  function itemUnlockRuleActive(rule,extraSource){
    return (rule.weapons||[]).some(id=>(state.weapons?.[id]||0)>0||(extraSource?.kind==='weapon'&&extraSource.id===id))||
      (rule.items||[]).some(id=>upCount(id)>0||(extraSource?.kind==='item'&&extraSource.id===id))||
      (rule.evolutions||[]).some(id=>upCount(id)>0||(extraSource?.kind==='evolution'&&extraSource.id===id));
  }
  function itemUnlockedForBuild(item,extraSource){
    const rule=ITEM_UNLOCK_RULES[item.id];
    return !rule||upCount(item.id)>0||itemUnlockRuleActive(rule,extraSource);
  }
  function itemsUnlockedByChoice(choice){
    const kind=Object.prototype.hasOwnProperty.call(state.weapons||{},choice.id)?'weapon':evolutionUpgrades.some(item=>item.id===choice.id)?'evolution':'item';
    if((kind==='weapon'&&(state.weapons[choice.id]||0)>0)||(kind!=='weapon'&&upCount(choice.id)>0))return [];
    const extraSource={kind,id:choice.id};
    return upgrades.filter(item=>ITEM_UNLOCK_RULES[item.id]&&!itemUnlockedForBuild(item)&&itemUnlockedForBuild(item,extraSource));
  }
  function evolutionHintsForChoice(choice){
    if(!choice||choice.type==='ЭВОЛЮЦИЯ')return[];
    return evolutionUpgrades.flatMap(evolution=>{
      if(upCount(evolution.id))return[];const choosingRequiredItem=evolution.requires===choice.id,choosingWeapon=evolution.weapon===choice.id;if(!choosingRequiredItem&&!choosingWeapon)return[];
      const weaponLevel=Number(state.weapons?.[evolution.weapon]||0),projectedWeaponLevel=choosingWeapon?Math.min(8,Math.max(1,weaponLevel+1)):weaponLevel,requiredItem=upgrades.find(item=>item.id===evolution.requires),hasCounterpart=choosingRequiredItem?weaponLevel>0:upCount(evolution.requires)>0;if(!hasCounterpart)return[];
      return[{evolution,weapon:WEAPON_INFO[evolution.weapon],weaponLevel:projectedWeaponLevel,requiredItem,ready:projectedWeaponLevel>=8}];
    });
  }
  function itemUnlockRequirementText(item){
    const rule=ITEM_UNLOCK_RULES[item.id];if(!rule)return '';
    const names=[...(rule.weapons||[]).map(id=>WEAPON_INFO[id]?.name||id),...(rule.items||[]).map(id=>upgrades.find(entry=>entry.id===id)?.name||id),...(rule.evolutions||[]).map(id=>evolutionUpgrades.find(entry=>entry.id===id)?.name||id)];
    return names.join(' или ');
  }
  const allRelics=()=>[...upgrades,...bossRelics,...evolutionUpgrades,...riftResonanceUpgrades];
  const relicInfo=id=>allRelics().find(item=>item.id===id);
  const hasEvolution=weapon=>Boolean(state.relics[evolutionUpgrades.find(item=>item.weapon===weapon)?.id]);
  const equippedWeaponIds=()=>Object.entries(state.weapons||{}).filter(([,level])=>level>0).map(([id])=>id);
  const equippedItemIds=()=>upgrades.filter(item=>item.type!=='ОРУЖИЕ'&&upCount(item.id)>0).map(item=>item.id);
  function hasUpgradeSlot(item){
    if(item.type==='ОРУЖИЕ')return Boolean(state.weapons[item.id])||equippedWeaponIds().length<currentWeaponSlotLimit();
    if(!upgrades.includes(item)||item.type==='ЭВОЛЮЦИЯ')return true;
    return upCount(item.id)>0||equippedItemIds().length<ITEM_SLOT_LIMIT;
  }
  const choicePool=kind=>kind==='totem'?totemUpgrades:kind==='endless'?endlessTotems:kind==='boss'||kind==='chest'?bossRelics:upgrades;
  const findChoiceItem=(id,kind)=>(kind==='level'?[...upgrades,...evolutionUpgrades,...riftResonanceUpgrades]:choicePool(kind)).find(item=>item.id===id);
  const rarityStyle = {
    common:{color:'#a6b2c3',glow:'rgba(150,170,200,.12)',label:'ОБЫЧНОЕ'},
    rare:{color:'#38f3ff',glow:'rgba(56,243,255,.14)',label:'РЕДКОЕ'},
    epic:{color:'#a56cff',glow:'rgba(165,108,255,.16)',label:'ЭПИЧЕСКОЕ'},
    legendary:{color:'#ffbd3d',glow:'rgba(255,189,61,.18)',label:'АБСУРДНОЕ'},
    cursed:{color:'#ff3f68',glow:'rgba(255,63,104,.22)',label:'ПРОКЛЯТОЕ'},
    boss:{color:'#ff5ca8',glow:'rgba(255,55,150,.24)',label:'БОСС-РЕЛИКВИЯ'},
    evolved:{color:'#63ffb0',glow:'rgba(70,255,165,.24)',label:'ЭВОЛЮЦИЯ'},
    rift:{color:'#ff8df4',glow:'rgba(255,80,220,.25)',label:'ПОЗДНЕЕ УСИЛЕНИЕ'}
  };

  // ---------- Run and UI ----------
  function startGame() {
    if(isCoop())closeCoop();
    resetFloatingStick();
    audio.init();
    state=makeRun();player={x:0,z:0,y:0};enemies=[];activeStandards=[];projectiles=[];enemyProjectiles=[];gems=[];particles=[];beams=[];zones=[];consumables=[];worldTotems=[];heroUnits=[];clearCombatTexts();generateMapObstacles();
    document.body.classList.toggle('rtx-mode',state.graphics==='rtx');
    pendingLevels=0;pendingChests=0;shake=0;uiTick=uiSlowTick=0;nextNetId=1;remotePlayer=null;applyHeroLoadout();applyChallengeLoadout();coopActors=[captureLocalActor('p1','Игрок 1')];setCameraMode('overhead',false);
    $('#menu').classList.remove('active');
    $('#hud').classList.remove('hidden');
    $('#endScreen').classList.add('hidden');$('#pauseScreen').classList.add('hidden');$('#choiceScreen').classList.add('hidden');$('#buildInspector').classList.add('hidden');
    for(let i=0;i<9;i++){
      const e=spawnEnemy(i%4===0?'runner':'grunt'),a=i/9*TAU,d=10+(i%3)*2;
      placeEnemy(e,player.x+Math.cos(a)*d,player.z+Math.sin(a)*d);
    }
    updateSlots();updateUI(true);toast(`<b>${HEROES[state.hero].name}</b> · ${state.challengeName} · SEED ${state.seedCode}${state.startingBossRelic?`<br><small>Стартовая реликвия: ${state.startingBossRelic}</small>`:''}`,'#ffbd3d');audio.tone(440,.15,'sawtooth',.04);
  }
  function returnMenu() {
    if(isCoop())closeCoop();
    resetFloatingStick();
    state={mode:'menu'};setCameraMode('overhead',false);enemies=[];activeStandards=[];projectiles=[];enemyProjectiles=[];gems=[];particles=[];beams=[];zones=[];consumables=[];worldTotems=[];heroUnits=[];clearCombatTexts();obstacles=[];obstacleGrid=new Map();generatedObstacleCells=new Set();obstacleGenerationX=Infinity;obstacleGenerationZ=Infinity;
    coopActors=[];remotePlayer=null;$('#coopChoicePanel').classList.add('hidden');$('#coopPeerHud').classList.add('hidden');
    document.body.classList.toggle('rtx-mode',selectedGraphics==='rtx');document.body.classList.remove('target-lock-active');$('#targetLockHud').classList.add('hidden');canvas.dataset.targetMode='auto';canvas.dataset.targetNid='';$('#buildInspector').classList.add('hidden');
    $('#hud').classList.add('hidden');$$('.overlay').forEach(e=>e.classList.add('hidden'));$('#menu').classList.add('active');
    showMenuPage('home','back');loadBest();
  }
  function readEndlessRecords(){try{const value=JSON.parse(localStorage.getItem('riftEndlessRecords')||'[]');return Array.isArray(value)?value:[];}catch(_error){return[];}}
  function saveEndlessRecord(stats){if(!state.endless||state.endlessRecorded)return;state.endlessRecorded=true;const records=readEndlessRecords();records.push({time:Math.floor(state.time),kills:stats.kills||0,level:stats.level||1,hero:state.hero||selectedHero,runPace:state.runPace||'standard',challenge:state.challenge||'classic',seedCode:state.seedCode||'',date:new Date().toISOString().slice(0,10)});records.sort((a,b)=>b.time-a.time||b.kills-a.kills);try{localStorage.setItem('riftEndlessRecords',JSON.stringify(records.slice(0,10)));}catch(_error){}}
  function renderEndlessRecords(){const records=readEndlessRecords().slice(0,5);$('#endlessRecords').innerHTML=records.length?records.map((record,index)=>`<div><b>${index+1}</b><span>${formatTime(record.time)}</span><small>${record.runPace==='rush'?'УСКОРЕННЫЙ · ':''}${String(record.hero||'hero').toUpperCase()} · ${record.seedCode?`SEED ${record.seedCode} · `:''}ур. ${record.level} · ${Number(record.kills||0).toLocaleString('ru-RU')} убийств</small></div>`).join(''):`<p>Переживи ${Math.round(runDuration()/60)} минут и войди в Бесконечный Разлом.</p>`;}
  function average(values){const clean=values.filter(Number.isFinite);return clean.length?clean.reduce((sum,value)=>sum+value,0)/clean.length:0;}
  function balanceReportData(stats=state.stats){
    const samples=[...(state.balance?.samples||[])],events=[...(state.balance?.events||[])],last=samples.at(-1)||{},peakDps=samples.reduce((best,sample)=>sample.dps>(best.dps||0)?sample:best,{}),peakEnemies=samples.reduce((best,sample)=>sample.enemyCount>(best.enemyCount||0)?sample:best,{}),bossKills=events.filter(event=>event.type==='boss_kill'||event.type==='miniboss_kill'),lateSamples=samples.slice(Math.floor(samples.length*.5)),dominance=samples.find((sample,index)=>index>=2&&samples.slice(index-2,index+1).every(point=>point.killRatio>=.85&&point.nearRatio<=.08)),finalExpected=Number(last.expectedLevel??expectedPlayerLevel()),levelDelta=Number(((stats.level||1)-finalExpected).toFixed(1)),avgKillRatio=average(lateSamples.map(sample=>sample.killRatio)),avgNearRatio=average(lateSamples.map(sample=>sample.nearRatio)),stationaryShare=Number((last.stationaryShare??state.balance?.stationaryTime/Math.max(.1,state.balance?.activeTime||1)??0).toFixed(3)),avgIncoming=average(samples.map(sample=>sample.incomingDps)),minFps=samples.length?Math.min(...samples.map(sample=>sample.fps||999)):0,avgBossTtk=average(bossKills.map(event=>event.ttk));
    const findings=[
      {label:'УРОВЕНЬ К ФИНАЛУ',value:`${stats.level} / ${Math.round(finalExpected)}`,detail:`отклонение ${levelDelta>=0?'+':''}${levelDelta}`},
      {label:'ПИК DPS',value:shortNumber(peakDps.dps||stats.bestDps||0),detail:peakDps.time==null?'нет данных':formatTime(peakDps.time)},
      {label:'ПИК ВРАГОВ',value:String(peakEnemies.enemyCount||0),detail:peakEnemies.time==null?'нет данных':formatTime(peakEnemies.time)},
      {label:'УБИЙСТВА / СПАВН',value:`${Math.round(avgKillRatio*100)}%`,detail:'среднее во второй половине'},
      {label:'ВРАГИ В 8 М',value:`${Math.round(avgNearRatio*100)}%`,detail:'доля добравшихся близко'},
      {label:'БЕЗ ДВИЖЕНИЯ',value:`${Math.round(stationaryShare*100)}%`,detail:dominance?`доминирование с ${formatTime(dominance.time)}`:'явной точки доминирования нет'},
      {label:'ВХОДЯЩИЙ УРОН',value:`${avgIncoming.toFixed(1)}/с`,detail:`получено ${Math.round(stats.damageTaken||0).toLocaleString('ru-RU')}`},
      {label:'БОССЫ',value:String(bossKills.length),detail:bossKills.length?`средний TTK ${avgBossTtk.toFixed(1)} с`:'убийств нет'}
    ];
    return{schema:'rift-balance-report',version:BALANCE_REPORT_VERSION,generatedAt:new Date().toISOString(),run:{seed:state.seedCode,hero:state.hero,heroName:HEROES[state.hero]?.name||state.hero,pace:state.runPace,duration:Number(state.time.toFixed(2)),won:Boolean(state.runWon),endless:Boolean(state.endless),challenge:state.challenge,challengeName:state.challengeName,map:state.map,hardcore:Boolean(state.hardcore),custom:Boolean(state.custom),graphics:state.graphics},difficulty:{...state.difficulty},summary:{level:stats.level,expectedLevel:Number(finalExpected.toFixed(2)),levelDelta,kills:stats.kills,damageDone:Math.round(stats.damageDone||0),damageTaken:Math.round(stats.damageTaken||0),healingDone:Math.round(stats.healingDone||0),damageBlocked:Math.round(stats.damageBlocked||0),bestDps:Math.round(stats.bestDps||0),criticalHits:stats.criticalHits||0,peakDps:Math.round(peakDps.dps||0),peakDpsTime:peakDps.time??0,peakEnemies:peakEnemies.enemyCount||0,peakEnemiesTime:peakEnemies.time??0,averageLateKillRatio:Number(avgKillRatio.toFixed(3)),averageLateNearRatio:Number(avgNearRatio.toFixed(3)),stationaryShare,dominanceTime:dominance?.time??null,averageIncomingDps:Number(avgIncoming.toFixed(3)),minimumSampledFps:Number(minFps.toFixed(1)),bossKills:bossKills.length,averageBossTtk:Number(avgBossTtk.toFixed(2))},build:{weapons:Object.entries(state.weapons).filter(([,level])=>level>0).map(([id,level])=>({id,name:WEAPON_INFO[id]?.name||id,level,evolution:evolutionUpgrades.find(item=>item.weapon===id&&state.relics[item.id])?.name||null})),items:Object.entries(state.relics).filter(([id,value])=>value&&upgrades.some(item=>item.id===id&&item.type!=='ОРУЖИЕ')).map(([id,rank])=>({id,name:relicInfo(id)?.name||id,rank})),bossRelics:Object.entries(state.relics).filter(([id,value])=>value&&bossRelics.some(item=>item.id===id)).map(([id,rank])=>({id,name:relicInfo(id)?.name||id,rank})),evolutions:evolutionUpgrades.filter(item=>state.relics[item.id]).map(item=>({id:item.id,name:item.name,weapon:item.weapon})),totems:Object.entries(state.totems).filter(([,rank])=>rank>0).map(([id,rank])=>({id,rank}))},damageBySource:{...(stats.damageBySource||{})},killsBySource:{...(stats.killsBySource||{})},findings,samples,events};
  }
  function reportLine(ctx,points,x,y,width,height,maxValue,color,valueOf){if(points.length<2||maxValue<=0)return;const firstTime=points[0].time||0,lastTime=points.at(-1).time||firstTime+1,timeSpan=Math.max(.001,lastTime-firstTime);ctx.beginPath();for(let index=0;index<points.length;index++){const point=points[index],px=x+clamp(((point.time||0)-firstTime)/timeSpan,0,1)*width,py=y+height-clamp(valueOf(point)/maxValue,0,1)*height;if(index===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.strokeStyle=color;ctx.lineWidth=3;ctx.shadowColor=color;ctx.shadowBlur=8;ctx.stroke();ctx.shadowBlur=0;}
  function reportChart(ctx,samples,rect,title,series){
    const {x,y,w,h}=rect;ctx.fillStyle='rgba(255,255,255,.025)';ctx.fillRect(x,y,w,h);ctx.strokeStyle='rgba(255,255,255,.08)';ctx.strokeRect(x+.5,y+.5,w-1,h-1);ctx.font='700 15px Arial';ctx.fillStyle='#aeb9cb';ctx.fillText(title,x+14,y+23);const plot={x:x+14,y:y+34,w:w-28,h:h-54};for(let grid=0;grid<=4;grid++){const gy=plot.y+plot.h*grid/4;ctx.strokeStyle='rgba(255,255,255,.045)';ctx.beginPath();ctx.moveTo(plot.x,gy);ctx.lineTo(plot.x+plot.w,gy);ctx.stroke();}
    const maxValue=Math.max(1,...samples.flatMap(sample=>series.map(item=>item.value(sample))));for(const item of series)reportLine(ctx,samples,plot.x,plot.y,plot.w,plot.h,maxValue,item.color,item.value);let legendX=x+w-14;ctx.font='12px Arial';for(let index=series.length-1;index>=0;index--){const item=series[index],label=`● ${item.label}`;const size=ctx.measureText(label).width;legendX-=size;ctx.fillStyle=item.color;ctx.fillText(label,legendX,y+22);legendX-=16;}ctx.fillStyle='#5f6b7e';ctx.font='11px Consolas';ctx.fillText('00:00',plot.x,y+h-7);ctx.textAlign='right';ctx.fillText(formatTime(samples.at(-1)?.time||0),plot.x+plot.w,y+h-7);ctx.textAlign='left';
  }
  function drawBalanceReport(report){
    const canvas=$('#balanceReportCanvas'),ctx=canvas.getContext('2d'),samples=report.samples.length?report.samples:[{time:0,level:report.summary.level,expectedLevel:report.summary.expectedLevel,dps:0,killsPerSecond:0,spawnRate:0,adaptiveHealth:1,nearRatio:0}];ctx.clearRect(0,0,canvas.width,canvas.height);const gradient=ctx.createLinearGradient(0,0,canvas.width,canvas.height);gradient.addColorStop(0,'#09131f');gradient.addColorStop(.55,'#070a12');gradient.addColorStop(1,'#100817');ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#38f3ff';ctx.font='900 18px Arial';ctx.fillText('ЛАБОРАТОРИЯ БАЛАНСА // RIFT REPORT',30,34);ctx.fillStyle='#f4f7ff';ctx.font='900 32px Arial';ctx.fillText(`${report.run.heroName} · ${report.run.pace==='rush'?'УСКОРЕННЫЙ':'ОБЫЧНЫЙ'} РЕЖИМ`,30,70);ctx.fillStyle='#738096';ctx.font='14px Consolas';ctx.fillText(`SEED ${report.run.seed} · ${formatTime(report.run.duration)} · УРОВЕНЬ ${report.summary.level} · ${report.summary.kills.toLocaleString('ru-RU')} УБИЙСТВ`,30,96);
    const chips=[['ПИК DPS',shortNumber(report.summary.peakDps)],['ПИК ВРАГОВ',String(report.summary.peakEnemies)],['БЕЗ ДВИЖЕНИЯ',`${Math.round(report.summary.stationaryShare*100)}%`],['БОССЫ',`${report.summary.bossKills} · ${report.summary.averageBossTtk.toFixed(1)}с`]];chips.forEach(([label,value],index)=>{const x=30+index*286;ctx.fillStyle='rgba(255,255,255,.035)';ctx.fillRect(x,115,268,58);ctx.fillStyle='#657188';ctx.font='11px Arial';ctx.fillText(label,x+12,136);ctx.fillStyle=index===0?'#38f3ff':index===1?'#ff687f':'#ffbd3d';ctx.font='900 19px Arial';ctx.fillText(value,x+12,161);});
    reportChart(ctx,samples,{x:30,y:192,w:1140,h:135},'УРОВЕНЬ: ФАКТИЧЕСКИЙ И ОЖИДАЕМЫЙ',[{label:'ФАКТ',color:'#38f3ff',value:sample=>sample.level||0},{label:'ОЖИДАНИЕ',color:'#a56cff',value:sample=>sample.expectedLevel||0}]);
    reportChart(ctx,samples,{x:30,y:340,w:1140,h:135},'DPS · ЛОГАРИФМИЧЕСКАЯ ШКАЛА',[{label:'DPS',color:'#38f3ff',value:sample=>Math.log10(1+(sample.dps||0))},{label:'ВХОДЯЩИЙ УРОН',color:'#ff5f78',value:sample=>Math.log10(1+(sample.incomingDps||0))}]);
    reportChart(ctx,samples,{x:30,y:488,w:1140,h:135},'ПОТОК: УБИЙСТВА И СПАВН В СЕКУНДУ',[{label:'УБИЙСТВА/С',color:'#63ffb0',value:sample=>sample.killsPerSecond||0},{label:'СПАВН/С',color:'#ffbd3d',value:sample=>sample.spawnRate||0}]);
    reportChart(ctx,samples,{x:30,y:636,w:1140,h:135},'ДАВЛЕНИЕ: АДАПТИВНОЕ HP И ВРАГИ РЯДОМ',[{label:'АДАПТАЦИЯ HP',color:'#a56cff',value:sample=>(sample.adaptiveHealth||1)*100},{label:'ВРАГИ В 8 М',color:'#ff687f',value:sample=>(sample.nearRatio||0)*100}]);canvas.dataset.samples=String(report.samples.length);canvas.dataset.schema=report.schema;
  }
  function renderBalanceLab(stats){if(!TELEMETRY_ENABLED||!state.balance)return;const report=balanceReportData(stats);state.balance.report=report;drawBalanceReport(report);$('#balanceFindings').innerHTML=report.findings.map(item=>`<div class="balance-finding"><span>${item.label}</span><b>${item.value}</b></div>`).join('');}
  function balanceFilename(extension){return`rift-balance-${String(state.seedCode||'run').toLowerCase()}-${Math.floor(state.time)}s.${extension}`;}
  function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function downloadBalanceJson(){if(!TELEMETRY_ENABLED)return;const report=state.balance?.report||balanceReportData();downloadBlob(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),balanceFilename('json'));}
  function downloadBalancePng(){if(!TELEMETRY_ENABLED)return;const canvas=$('#balanceReportCanvas');canvas.toBlob(blob=>{if(blob)downloadBlob(blob,balanceFilename('png'));},'image/png');}
  function renderRunDetails(stats){const detailStats=$('.end-detail-stats'),balanceLab=$('#balanceLab');$('#endDpsStat').classList.toggle('hidden',!TELEMETRY_ENABLED);detailStats.classList.toggle('telemetry-disabled',!TELEMETRY_ENABLED);balanceLab.classList.toggle('hidden',!TELEMETRY_ENABLED);if(TELEMETRY_ENABLED){stats.bestDps=Math.max(stats.bestDps||0,stats.dpsWindow||0);$('#endBestDps').textContent=Math.floor(stats.bestDps).toLocaleString('ru-RU');}$('#endCrits').textContent=Number(stats.criticalHits||0).toLocaleString('ru-RU');$('#endHealing').textContent=Math.floor(stats.healingDone||0).toLocaleString('ru-RU');$('#endBlocked').textContent=Math.floor(stats.damageBlocked||0).toLocaleString('ru-RU');const rows=Object.entries(stats.damageBySource||{}).filter(([,damage])=>damage>0).sort((a,b)=>b[1]-a[1]).slice(0,24),total=Math.max(1,rows.reduce((sum,[,damage])=>sum+damage,0));$('#damageBreakdown').innerHTML=rows.length?rows.map(([source,damage])=>`<div><span>${DAMAGE_SOURCE_NAMES[source]||source}</span><b>${Math.floor(damage).toLocaleString('ru-RU')}</b><i style="--share:${Math.max(.02,damage/total)}"></i><small>${Number(stats.killsBySource?.[source]||0).toLocaleString('ru-RU')} убийств</small></div>`).join(''):'<p>Урон ещё не был нанесён.</p>';renderEndlessRecords();if(TELEMETRY_ENABLED)renderBalanceLab(stats);}
  function endGame(win=false,fromNetwork=false) {
    if(state.mode==='end')return;
    resetFloatingStick();
    if(state.balance){state.balance.sampleClock=0;updateBalanceTelemetry(0);}
    state.mode='end';state.runWon=win;setCameraMode('overhead',false);document.body.classList.remove('target-lock-active');$('#targetLockHud').classList.add('hidden');canvas.dataset.targetMode='auto';canvas.dataset.targetNid='';$('#buildInspector').classList.add('hidden');
    $('#coopChoicePanel').classList.add('hidden');$('#coopChoicePanel').classList.remove('waiting');$('#choiceScreen').classList.add('hidden');
    if(coopNet.mode==='host'&&!fromNetwork){const packet={type:'game-over',win,time:state.time,runPace:state.runPace,runDuration:runDuration(),timelineScale:runTimelineScale(),xpPace:state.xpPace};sendCoop(packet);setTimeout(()=>sendCoop(packet),180);setTimeout(()=>sendCoop(packet),650);}
    const displayActor=coopActors.find(actor=>actor.local)||coopActors[0],displayStats=displayActor?.stats||state.stats,displayWeapons=displayActor?.weapons||state.weapons,displayRelics=displayActor?.relics||state.relics;
    if(state.endless)saveEndlessRecord(displayStats);
    const bestKey=state.runPace==='rush'?'riftBestRush':'riftBest',best=Math.max(Number(localStorage.getItem(bestKey)||0),state.time);localStorage.setItem(bestKey,best);
    $('#endKicker').textContent=state.endless?'БЕСКОНЕЧНЫЙ РАЗЛОМ':win?`${Math.round(runDuration()/60)} МИНУТ ВЫЖИВАНИЯ`:'ЗАБЕГ ОКОНЧЕН';
    $('#endTitle').textContent=state.endless?(win?'РАЗЛОМ ПОДЧИНИЛСЯ':'БЕСКОНЕЧНОСТЬ ОКАЗАЛАСЬ СИЛЬНЕЕ'):win?'ТЫ СЛОМАЛ БЕЗДНУ':'БЕЗДНА ПОГЛОТИЛА ТЕБЯ';
    const resultText=state.endless?`Ты продержался в Разломе ещё ${formatTime(Math.max(0,state.time-runDuration()))}.`:win?'Баланс уничтожен. Теперь можно войти туда, где баланса не существует.':'Но следующий билд будет ещё безумнее.';$('#endSubtitle').textContent=`${resultText} ${state.challengeName||''} · SEED ${state.seedCode||'—'}`;
    $('#endTime').textContent=formatTime(state.time);$('#endKills').textContent=displayStats.kills.toLocaleString('ru-RU');
    $('#endLevel').textContent=displayStats.level;$('#endDamage').textContent=Math.floor(displayStats.damageDone).toLocaleString('ru-RU');
    renderRunDetails(displayStats);$('#buildSummary').innerHTML=Object.entries(displayWeapons).filter(([,v])=>v).map(([id,v])=>{const evolution=evolutionUpgrades.find(item=>item.weapon===id&&displayRelics[item.id]);return slotHTML(evolution?.icon||WEAPON_INFO[id].icon,evolution?'EVO':v,`weapon${evolution?' evolved':''}`)}).join('')+
      Object.entries(displayRelics).filter(([,v])=>v).slice(-10).map(([id,v])=>slotHTML(relicInfo(id)?.icon||'◆',v,'relic')).join('');
    const canContinue=win&&!state.endless&&state.time>=runDuration();$('#continueEndlessBtn').classList.toggle('hidden',!canContinue);$('#continueEndlessBtn').disabled=coopNet.mode==='guest';$('#continueEndlessBtn').textContent=coopNet.mode==='guest'?'ХОСТ РЕШАЕТ, ПРОДОЛЖАТЬ ЛИ':'ВОЙТИ В БЕСКОНЕЧНЫЙ РАЗЛОМ';
    $('#endScreen').classList.remove('hidden');audio.tone(win?660:90,.7,win?'square':'sawtooth',.055);
  }
  function enterEndless(fromNetwork=false){
    if(state.endless)return;state.endless=true;state.endlessNextBoss=state.time+pacedDelay(180);state.endlessNextTotem=state.time+pacedDelay(2);state.runWon=false;state.mode=coopNet.mode==='guest'?'remote':'playing';$('#endScreen').classList.add('hidden');$('#continueEndlessBtn').classList.add('hidden');
    if(coopNet.mode!=='guest'){triggerHorde();spawnBoss();if(coopNet.mode==='host'&&!fromNetwork){sendCoop({type:'event',event:'continue-endless',time:state.time});sendRunState();sendSnapshot(true);}}
    toast('<b>БЕСКОНЕЧНЫЙ РАЗЛОМ</b> · угроза ускоряется без ограничений','#63ffb0');audio.tone(52,.9,'sawtooth',.075);updateUI(true);
  }
  function updateEndless(){
    if(!state.endless)return;if(state.time>=state.endlessNextBoss){spawnBoss();triggerHorde();state.endlessNextBoss+=pacedDelay(180);}
    if(state.time>=state.endlessNextTotem){if(isCoopHost()){for(const actor of liveActors()){actor.pendingEndless=(actor.pendingEndless||0)+1;if(!actor.choice)withActor(actor,()=>openCompactChoice('endless'));}}else if(!isCoop()&&state.mode==='playing')openChoice('endless');state.endlessNextTotem+=pacedDelay(240);}
  }
  function pauseToggle() {
    if(isCoop()){toast('<b>КООПЕРАТИВ</b> · общая пауза отключена, забег продолжается','#38f3ff');return;}
    if(state.mode==='playing'){resetFloatingStick();state.mode='paused';releaseCameraPointerLock();$('#pauseScreen').classList.remove('hidden');}
    else if(state.mode==='paused'){state.mode='playing';$('#pauseScreen').classList.add('hidden');audio.init();requestCameraPointerLock();}
  }
  function loadBest(){const rush=selectedRunPace==='rush',key=rush?'riftBestRush':'riftBest';$('#bestTime').textContent=`Рекорд${rush?' 10 мин':''}: ${formatTime(Number(localStorage.getItem(key)||0))}`;}
  function slotHTML(icon,lvl,kind,name=''){return `<div class="slot ${kind}"><span class="icon">${icon}</span><span class="lvl">${lvl}</span>${name?`<span class="tip">${name} · ур. ${lvl}</span>`:''}</div>`;}
  function emptySlotHTML(kind,name){return `<div class="slot ${kind} empty"><span class="icon">·</span><span class="tip">${name}</span></div>`;}
  function updateSlots() {
    if(!state.weapons)return;
    const weaponLimit=currentWeaponSlotLimit(),weapons=Object.entries(state.weapons).filter(([,v])=>v).slice(0,weaponLimit),items=equippedItemIds().slice(0,ITEM_SLOT_LIMIT).map(id=>[id,upCount(id)]);
    $('#weaponSlots').innerHTML=weapons.map(([id,v])=>{const evolution=evolutionUpgrades.find(item=>item.weapon===id&&state.relics[item.id]);return slotHTML(evolution?.icon||WEAPON_INFO[id].icon,evolution?'EVO':v,`weapon${evolution?' evolved':''}`,evolution?.name||WEAPON_INFO[id].name)}).join('')+Array.from({length:weaponLimit-weapons.length},()=>emptySlotHTML('weapon','Свободный слот оружия')).join('');
    $('#itemSlots').innerHTML=items.map(([id,v])=>{const item=relicInfo(id);return slotHTML(item.icon,v,'item',item.name)}).join('')+Array.from({length:ITEM_SLOT_LIMIT-items.length},()=>emptySlotHTML('item','Свободный слот предмета')).join('');
    $('#relicSlots').innerHTML=Object.entries(state.relics).filter(([id,v])=>{const item=relicInfo(id);return v&&item&&item.type==='РЕЛИКВИЯ БОССА'}).slice(-7).map(([id,v])=>{const item=relicInfo(id);return slotHTML(item.icon,v,'relic',item.name)}).join('');
    const activeTotems=Object.entries(state.totems).filter(([,v])=>v);
    $('#totemSlots').innerHTML=activeTotems.slice(-8).map(([id,v])=>{const t=[...totemUpgrades,...endlessTotems].find(x=>x.id===id);return t?`<span class="totem-pip" title="${t.name} ×${v}">${t.icon}</span>`:''}).join('');
  }
  function toast(text,accent='var(--cyan)') {
    const e=document.createElement('div');e.className='toast';e.style.borderColor=accent;e.innerHTML=text;$('#toastStack').append(e);setTimeout(()=>e.remove(),3400);
  }
  function setHudText(selector,value){const element=$(selector),next=String(value);if(element&&element.textContent!==next)element.textContent=next;}
  function setHudStyle(selector,property,value){const element=$(selector),next=String(value);if(element&&element.style[property]!==next)element.style[property]=next;}
  function updateUI(force=false) {
    if(!state.stats)return;const s=state.stats,slow=force||uiSlowTick<=0;
    setHudText('#hpText',`${Math.ceil(s.hp)} / ${Math.ceil(s.maxHp)}`);setHudStyle('#hpBar','width',`${clamp(s.hp/s.maxHp*100,0,100)}%`);
    setHudText('#levelText',`УРОВЕНЬ ${s.level}`);setHudText('#xpText',`${Math.floor(s.xp)} / ${s.xpNeed}`);setHudStyle('#xpBar','width',`${clamp(s.xp/s.xpNeed*100,0,100)}%`);setHudText('#timer',formatTime(state.time));
    setHudText('#hordeTimer',state.hordeRemaining>0?(state.hordeDuration>0?`ВХОД · ${Math.max(1,Math.ceil(state.hordeDuration))}с`:'ВХОДИТ'):formatTime(Math.max(0,state.nextHorde-state.time)));
    const activeBuffs=Object.entries(state.buffs).filter(([id,time])=>time>0&&CONSUMABLES[id]);
    const buffBar=$('#buffBar'),buffKey=activeBuffs.map(([id])=>id).join('|');if(buffBar.dataset.key!==buffKey){buffBar.dataset.key=buffKey;buffBar.innerHTML=activeBuffs.map(([id])=>{const c=CONSUMABLES[id];return `<div class="buff-chip" data-buff-id="${id}" style="--buff:${c.color}"><span class="buff-icon">${c.icon}</span><div><b></b><small>${c.name}</small><span class="buff-time"></span></div></div>`}).join('');}
    for(const [id,time] of activeBuffs){const chip=buffBar.querySelector(`[data-buff-id="${id}"]`),max=timedBuffDuration(CONSUMABLES[id].duration);if(chip){const label=`${time.toFixed(1)}с`,bar=`scaleX(${clamp(time/max,0,1)})`,text=chip.querySelector('b'),progress=chip.querySelector('.buff-time');if(text.textContent!==label)text.textContent=label;if(progress.style.transform!==bar)progress.style.transform=bar;}}
    const boss=enemies.find(e=>(e.boss||e.miniboss)&&!e.dead),bossWrap=$('#bossWrap');bossWrap.classList.toggle('hidden',!boss);if(boss){const copied=boss.bossKind==='mirror'&&boss.copiedWeapon?` · ${WEAPON_INFO[boss.copiedWeapon]?.name||boss.copiedWeapon}`:'',bossName=boss.miniboss?'СТРАЖ ПОЗДНЕГО РАЗЛОМА':`${boss.bossName||BOSS_ARCHETYPES[boss.bossKind]?.name||'РАЗРЫВАТЕЛЬ БЕЗДНЫ'}${copied}`;setHudText('.boss-name',bossName);setHudStyle('#bossBar','width',`${clamp(boss.hp/boss.maxHp*100,0,100)}%`);}
    updateTargetLockHud();
    if(isCoop())updatePeerHud();
    if(!slow)return;
    const threatName=threatLabel(state.threatTier),paceLabel=state.runPace==='rush'?'⚡ 10 МИН · ':'';setHudText('#threat',state.endless?`${paceLabel}∞ РАЗЛОМ · ${threatName}`:state.hardcore?`${paceLabel}☠ ХАРДКОР · ${threatName}`:state.custom?`${paceLabel}⚙ КАСТОМ · ${threatName}`:`${paceLabel}УГРОЗА ${threatName}`);
    setHudText('#damageStat',`×${(s.damageMult+s.bloodBonus+(s.levelPowerBonus||0)).toFixed(2)}`);setHudText('#rateStat',`${s.fireRate.toFixed(1)}×`);setHudText('#killStat',s.kills.toLocaleString('ru-RU'));
    const d=state.difficulty,tier=state.threatTier,late=post15Scales(),growth=enemyGrowth(state.time,tier),adaptive=state.adaptive||{health:1,damage:1,speed:1,expectedLevel:1},enemyHealth=growth.health*d.health*late.health*(adaptive.health||1),enemyDamage=growth.damage*d.damage*late.damage*(adaptive.damage||1),enemySpeed=growth.speed*d.speed*late.speed*(adaptive.speed||1),spawnRate=growth.spawn*d.spawn*late.spawn;
    setHudText('#threatBadge',threatName);setHudText('#totemCount',Object.values(state.totems).reduce((a,v)=>a+v,0));setHudText('#spawnDifficulty',`${spawnRate.toFixed(1)}/с`);setHudText('#healthDifficulty',`×${enemyHealth.toFixed(2)}`);setHudText('#damageDifficulty',`×${enemyDamage.toFixed(2)}`);setHudText('#speedDifficulty',`×${enemySpeed.toFixed(2)}`);setHudText('#bossDifficulty',`×${d.bosses}`);
    const adaptiveHealth=Math.round(((adaptive.health||1)-1)*100),adaptiveDamage=Math.round(((adaptive.damage||1)-1)*100),adaptiveSpeed=Math.round(((adaptive.speed||1)-1)*100),adaptiveLabel=adaptiveHealth>1?`ДАВЛЕНИЕ +${adaptiveHealth}% HP · +${Math.max(0,adaptiveDamage)}% УР · +${Math.max(0,adaptiveSpeed)}% СКР`:adaptiveHealth<-1?`ПОДДЕРЖКА ${adaptiveHealth}% HP`:'НЕЙТРАЛЬНО';setHudText('#adaptiveDifficulty',adaptiveLabel);setHudText('#expectedLevel',`ОЖИД. УР. ${Math.round(adaptive.expectedLevel||1)}`);
    if(!$('#buildInspector').classList.contains('hidden'))updateBuildInspector();
  }

  function shortNumber(value){const number=Math.max(0,Number(value)||0),units=['','K','M','B','T','Q'];if(number<1000)return Math.floor(number).toLocaleString('ru-RU');const tier=Math.min(units.length-1,Math.floor(Math.log10(number)/3)),scaled=number/1000**tier;return`${scaled>=100?scaled.toFixed(0):scaled>=10?scaled.toFixed(1):scaled.toFixed(2)}${units[tier]}`;}
  let buildInspectorResumeMode='',buildInspectorRestorePauseScreen=false,inspectorInventorySelected='';
  const inspectorInventoryEntries=new Map();
  const inspectorEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function inspectorDescription(item){try{return item?.desc?.()||item?.summary||'';}catch(_error){return item?.summary||'';}}
  function inspectorInventoryData(actor){
    const weapons=actor?.weapons||state.weapons||{},relics=actor?.relics||state.relics||{},stats=actor?.stats||state.stats||{};
    const weaponEntries=Object.entries(weapons).filter(([,level])=>Number(level)>0).map(([id,level])=>{
      const item=upgrades.find(entry=>entry.id===id&&entry.type==='ОРУЖИЕ'),evolution=evolutionUpgrades.find(entry=>entry.weapon===id&&relics[entry.id]);
      return{key:`weapon:${id}`,kind:'weapon',id,level:Number(level),item,evolution,resonanceBonus:Number(stats.riftWeaponPower?.[id]||0),name:evolution?.name||item?.name||WEAPON_INFO[id]?.name||id,icon:evolution?.icon||item?.icon||WEAPON_INFO[id]?.icon||'◆',rarity:evolution?'evolved':item?.rarity||'common'};
    });
    const itemEntries=upgrades.filter(item=>item.type!=='ОРУЖИЕ'&&Number(relics[item.id])>0).map(item=>({key:`item:${item.id}`,kind:'item',id:item.id,level:Number(relics[item.id]),item,name:item.name,icon:item.icon,rarity:item.rarity||'common'}));
    const evolutionEntries=evolutionUpgrades.filter(item=>Number(relics[item.id])>0).map(item=>({key:`evolution:${item.id}`,kind:'evolution',id:item.id,level:1,item,name:item.name,icon:item.icon,rarity:'evolved'}));
    const bossEntries=bossRelics.filter(item=>Number(relics[item.id])>0).map(item=>({key:`boss:${item.id}`,kind:'boss',id:item.id,level:1,item,name:item.name,icon:item.icon,rarity:item.rarity||'boss'}));
    const resonanceEntries=riftResonanceUpgrades.filter(item=>Number(relics[item.id])>0).map(item=>({key:`resonance:${item.id}`,kind:'resonance',id:item.id,level:Number(relics[item.id]),item,name:item.name,icon:item.icon,rarity:'rift'}));
    return{weaponEntries,itemEntries,specialEntries:[...evolutionEntries,...bossEntries,...resonanceEntries]};
  }
  function inspectorInventoryCard(entry){
    const rarity=rarityStyle[entry.rarity]||rarityStyle.common,caption=entry.kind==='weapon'?(entry.evolution?'ЭВОЛЮЦИЯ':'ОРУЖИЕ'):entry.kind==='evolution'?'ЭВОЛЮЦИЯ':entry.kind==='boss'?'БОСС-РЕЛИКВИЯ':entry.kind==='resonance'?'РЕЗОНАНС РАЗЛОМА':entry.item?.type||'ПРЕДМЕТ',rank=entry.kind==='weapon'?(entry.evolution?'EVO':`УР. ${entry.level}`):entry.kind==='evolution'||entry.kind==='boss'?'1 РАНГ':`РАНГ ${entry.level}`;
    return`<button class="build-inventory-card" type="button" data-inventory-key="${inspectorEsc(entry.key)}" style="--inventory-color:${rarity.color};--inventory-glow:${rarity.glow}"><span class="build-inventory-icon">${inspectorEsc(entry.icon)}</span><span class="build-inventory-copy"><b>${inspectorEsc(entry.name)}</b><small>${inspectorEsc(caption)}</small></span><span class="build-inventory-rank">${inspectorEsc(rank)}</span></button>`;
  }
  function inspectorDetailStats(rows){return`<div class="build-detail-stats">${rows.map(([label,value])=>`<div class="build-detail-stat"><span>${inspectorEsc(label)}</span><b>${inspectorEsc(value)}</b></div>`).join('')}</div>`;}
  function inspectorDetailTags(tags){return tags.length?`<div class="build-detail-tags">${tags.map(tag=>`<span class="build-detail-tag">${inspectorEsc(tag)}</span>`).join('')}</div>`:'';}
  function inspectorFormulaCurrent(label,formula,level){
    const calculated=codexFormulaValue(formula,label,level);if(calculated)return formatCodexPreview(calculated);
    const bonus=/снаряд/i.test(label)?state.stats.projectiles:/пробит/i.test(label)?state.stats.pierce:0;
    return String(formula).replaceAll('L',String(level)).replace(/бонус снарядов/gi,String(extraProjectileCount())).replace(/бонус героя/gi,String(bonus)).replace(/темп/gi,Number(state.stats.fireRate||1).toFixed(2));
  }
  function inspectorInventoryDetailHTML(entry){
    const rarity=rarityStyle[entry.rarity]||rarityStyle.common,item=entry.item||{},hero=(kicker,title,icon)=>`<div class="build-detail-hero"><span>${inspectorEsc(icon)}</span><div><small>${inspectorEsc(kicker)}</small><b>${inspectorEsc(title)}</b></div></div>`;
    if(entry.kind==='weapon'){
      const data=CODEX_WEAPONS[entry.id]||{summary:inspectorDescription(item),stats:[],impacts:[]},stats=data.stats.map(([label,formula])=>[label,inspectorFormulaCurrent(label,formula,entry.level)]),evolutionChanges=entry.evolution?CODEX_EVOLUTION_STATS[entry.evolution.id]||[]:[],kicker=entry.evolution?`ЭВОЛЮЦИЯ · УРОВЕНЬ ОРУЖИЯ ${entry.level}`:`${rarity.label} · ОРУЖИЕ · УРОВЕНЬ ${entry.level}`;if(entry.resonanceBonus>0)stats.push(['Резонанс Разлома',`+${(entry.resonanceBonus*100).toLocaleString('ru-RU',{maximumFractionDigits:1})}% урона`]);
      return hero(kicker,entry.name,entry.icon)+`<p class="build-detail-description">${inspectorEsc(data.summary)}</p><section class="build-detail-section"><h5>ТЕКУЩИЕ ХАРАКТЕРИСТИКИ</h5>${inspectorDetailStats(stats)}</section><section class="build-detail-section"><h5>УСИЛИВАЕТСЯ ОТ</h5>${inspectorDetailTags(data.impacts||[])}</section>${evolutionChanges.length?`<section class="build-detail-section"><h5>АКТИВНАЯ ЭВОЛЮЦИЯ</h5>${inspectorDetailStats(evolutionChanges.map((value,index)=>[`Модификатор ${index+1}`,value]))}</section>`:''}<p class="build-detail-note">Формулы уже рассчитаны для текущего уровня оружия. Глобальная сила урона, крит и ситуационные множители применяются поверх этих значений.</p>`;
    }
    if(entry.kind==='evolution'){
      const weapon=upgrades.find(candidate=>candidate.id===item.weapon),required=upgrades.find(candidate=>candidate.id===item.requires),changes=CODEX_EVOLUTION_STATS[item.id]||[];
      return hero('ЭВОЛЮЦИЯ · СТРОГО 1 РАНГ',item.name,item.icon)+`<p class="build-detail-description">${inspectorEsc(inspectorDescription(item))}</p><section class="build-detail-section"><h5>УСЛОВИЕ</h5>${inspectorDetailStats([['Базовое оружие',`${weapon?.name||item.weapon} · ур. 8`],['Требуемый предмет',required?.name||item.requires]])}</section><section class="build-detail-section"><h5>АКТИВНЫЕ ИЗМЕНЕНИЯ</h5>${inspectorDetailStats(changes.map((value,index)=>[`Модификатор ${index+1}`,value]))}</section>`;
    }
    const isBoss=entry.kind==='boss',isResonance=entry.kind==='resonance',impacts=isResonance?(item.preview||[]).map(([label])=>label):CODEX_ITEM_IMPACTS[item.id]||['Особый эффект'],note=CODEX_ITEM_NOTES[item.id],evolutions=evolutionUpgrades.filter(evolution=>evolution.requires===item.id),slot=isBoss?'Отдельный слот реликвии':isResonance?'Не занимает слот':'1 из 8 слотов предметов',maxRank=isResonance?'Без предела':String(item.max||1);
    return hero(`${rarity.label} · ${item.type||'ПРЕДМЕТ'} · РАНГ ${entry.level}${isResonance?'':`/${item.max||1}`}`,item.name,entry.icon)+`<p class="build-detail-description">${inspectorEsc(inspectorDescription(item))}</p><section class="build-detail-section"><h5>ХАРАКТЕРИСТИКИ</h5>${inspectorDetailStats([['Текущий ранг',String(entry.level)],['Максимальный ранг',maxRank],['Редкость',rarity.label],['Слот',slot]])}</section><section class="build-detail-section"><h5>ВЛИЯЕТ НА</h5>${inspectorDetailTags(impacts)}</section>${note?`<p class="build-detail-note">${inspectorEsc(note)}</p>`:''}${isResonance?'<p class="build-detail-note">Каждый ранг также усиливает всех текущих и будущих врагов: +1,5% здоровья и +0,5% скорости.</p>':''}${evolutions.length?`<p class="build-detail-note">Компонент эволюции: ${inspectorEsc(evolutions.map(evolution=>evolution.name).join(', '))}.</p>`:''}`;
  }
  function selectInspectorInventory(key){
    const entry=inspectorInventoryEntries.get(key);if(!entry)return;inspectorInventorySelected=key;
    $$('.build-inventory-card').forEach(card=>card.classList.toggle('selected',card.dataset.inventoryKey===key));
    const detail=$('#inspectorInventoryDetail'),rarity=rarityStyle[entry.rarity]||rarityStyle.common;detail.style.setProperty('--inventory-color',rarity.color);detail.innerHTML=inspectorInventoryDetailHTML(entry);
  }
  function renderBuildInventory(actor){
    const {weaponEntries,itemEntries,specialEntries}=inspectorInventoryData(actor),allEntries=[...weaponEntries,...itemEntries,...specialEntries];inspectorInventoryEntries.clear();for(const entry of allEntries)inspectorInventoryEntries.set(entry.key,entry);
    $('#inspectorWeaponCount').textContent=`${weaponEntries.length} / ${currentWeaponSlotLimit()}`;$('#inspectorItemCount').textContent=`${itemEntries.length} / ${ITEM_SLOT_LIMIT}`;
    const empty=label=>`<div class="build-inventory-empty">${label}</div>`;$('#inspectorWeaponList').innerHTML=weaponEntries.length?weaponEntries.map(inspectorInventoryCard).join(''):empty('ОРУЖИЯ ПОКА НЕТ');$('#inspectorItemList').innerHTML=itemEntries.length?itemEntries.map(inspectorInventoryCard).join(''):empty('ПРЕДМЕТОВ ПОКА НЕТ');$('#inspectorSpecialList').innerHTML=specialEntries.map(inspectorInventoryCard).join('');$('#inspectorSpecialGroup').classList.toggle('hidden',!specialEntries.length);
    $$('.build-inventory-card').forEach(card=>{const select=()=>selectInspectorInventory(card.dataset.inventoryKey);card.addEventListener('mouseenter',select);card.addEventListener('focus',select);card.addEventListener('click',event=>{event.preventDefault();select();});});
    if(!inspectorInventoryEntries.has(inspectorInventorySelected))inspectorInventorySelected=(itemEntries[0]||weaponEntries[0]||specialEntries[0])?.key||'';
    if(inspectorInventorySelected)selectInspectorInventory(inspectorInventorySelected);else{$('#inspectorInventoryDetail').style.removeProperty('--inventory-color');$('#inspectorInventoryDetail').innerHTML='<div class="build-inventory-placeholder">В текущем билде пока нет снаряжения.</div>';}
  }
  function updateBuildInspector(){
    const actor=coopActors.find(item=>item.local)||coopActors[0],s=actor?.stats||state.stats;if(!s)return;const buffs=actor?.buffs||state.buffs||{},base=s.damageMult+s.bloodBonus+(s.levelPowerBonus||0),missing=1-s.hp/Math.max(1,s.maxHp),desperation=1+missing*s.desperation*.12,crowd=enemies.length>100?1+s.crowdPower*.10:1,double=buffs.double>0?2:1,normal=base*desperation*crowd*double,boss=normal*(1+s.bossSlayer*.15),row=(label,detail,value,color='var(--cyan)')=>`<div class="formula-row" style="--formula:${color}"><span>${label}</span><code>${detail}</code><b>${value}</b></div>`;
    $('#inspectorRun').textContent=`${state.challengeName||CHALLENGES[state.challenge]?.name||'КЛАССИЧЕСКИЙ РАЗЛОМ'} · SEED ${state.seedCode||'—'} · УРОВЕНЬ ${s.level}`;
    $('#buildFormula').innerHTML=row('Основной урон',`база ${s.baseDamage.toFixed(2)} + Неприличная сила + прочее`,`×${s.damageMult.toFixed(2)}`)+row('Кровавая батарея',`ранг ${s.blood} · ${Math.round((s.bloodBonus||0)/s.baseDamage*100)}% базы`,`+${(s.bloodBonus||0).toFixed(2)}`,'#ff6f8b')+row('Корона экспоненты',`ранг ${s.levelPower} · ${Math.round((s.levelPowerBonus||0)/s.baseDamage*100)}% базы`,`+${(s.levelPowerBonus||0).toFixed(2)}`,'#a56cff')+row('АДДИТИВНЫЙ ПУЛ','сумма трёх строк выше',`×${base.toFixed(2)}`)+row('Красная зона',`${Math.round(missing*100)}% HP потеряно`,`×${desperation.toFixed(2)}`,'#a56cff')+row('Контроль толпы',`${enemies.length} врагов · порог 101`,`×${crowd.toFixed(2)}`,'#63ffb0')+row('Двойной урон',buffs.double>0?`${buffs.double.toFixed(1)} сек`:'неактивен',`×${double.toFixed(2)}`,'#ff6f8b')+row('ИТОГ · обычный','произведение выше',`×${normal.toFixed(2)}`,'#38f3ff')+row('ИТОГ · босс',`Убийца боссов ×${(1+s.bossSlayer*.15).toFixed(2)}`,`×${boss.toFixed(2)}`,'#ff3f68');
    const live=TELEMETRY_ENABLED?[['DPS · 1 СЕК',s.lastDps],['DPS · 10 СЕК',s.recentDpsTotal],['ЛУЧШИЙ DPS',s.bestDps],['КРИТ',`${Math.round(s.crit*100)}% · ×${s.critMult.toFixed(2)}`],['УРОН ВСЕГО',s.damageDone],['СНЯТО ОВЕРКИЛЛА',s.overkillPrevented]]:[['УРОН ВСЕГО',s.damageDone],['КРИТЫ',s.criticalHits||0],['ШАНС КРИТА',`${Math.round(s.crit*100)}%`],['КРИТ-УРОН',`×${s.critMult.toFixed(2)}`]];$('#buildLiveStats').innerHTML=live.map(([label,value])=>`<div><small>${label}</small><b>${typeof value==='string'?value:shortNumber(value)}</b></div>`).join('');$('#weaponTelemetryPanel').classList.toggle('hidden',!TELEMETRY_ENABLED);
    if(TELEMETRY_ENABLED){const rows=Object.entries(s.recentDpsBySource||{}).filter(([,dps])=>dps>0).sort((a,b)=>b[1]-a[1]),maximum=Math.max(1,...rows.map(([,dps])=>dps));$('#inspectorWeapons').innerHTML=rows.length?rows.map(([source,dps])=>`<div class="weapon-dps-row"><span>${DAMAGE_SOURCE_NAMES[source]||source}</span><b>${shortNumber(dps)} DPS</b><small>${shortNumber(s.damageBySource?.[source]||0)} всего · ${Number(s.killsBySource?.[source]||0).toLocaleString('ru-RU')} убийств</small><i style="--dps-share:${Math.max(.02,dps/maximum)}"></i></div>`).join(''):'<div class="weapon-dps-row"><span>Телеметрия появится после нанесения урона</span><b>0 DPS</b><small>Окно обновляется раз в секунду</small><i style="--dps-share:0"></i></div>';}
    renderBuildInventory(actor);
  }
  function toggleBuildInspector(force){
    const inspector=$('#buildInspector'),pauseScreen=$('#pauseScreen');
    if(!state.stats||!['playing','paused'].includes(state.mode)){inspector.classList.add('hidden');buildInspectorResumeMode='';buildInspectorRestorePauseScreen=false;return;}
    const show=force===undefined?inspector.classList.contains('hidden'):Boolean(force);
    if(show){
      buildInspectorResumeMode=state.mode==='playing'?'playing':'';buildInspectorRestorePauseScreen=!pauseScreen.classList.contains('hidden');resetFloatingStick();if(state.mode==='playing')state.mode='paused';pauseScreen.classList.add('hidden');inspector.classList.remove('hidden');releaseCameraPointerLock();updateBuildInspector();
    }else{
      inspector.classList.add('hidden');const resume=buildInspectorResumeMode==='playing'&&state.mode==='paused',restorePause=buildInspectorRestorePauseScreen&&state.mode==='paused';buildInspectorResumeMode='';buildInspectorRestorePauseScreen=false;if(resume){state.mode='playing';audio.init();requestCameraPointerLock();}else if(restorePause)pauseScreen.classList.remove('hidden');
    }
  }

  function weightedChoice(pool) {
    let weighted=[];
    for(const u of pool){let w=u.rarity==='common'?8:u.rarity==='rare'?5:u.rarity==='epic'?2.5:1;if(state.hero==='gambler')w*=u.rarity==='common'?.55:u.rarity==='rare'?1.15:u.rarity==='epic'?1.65:2.2;for(let i=0;i<Math.ceil(w+state.stats.luck);i++)weighted.push(u);}
    return weighted[Math.floor(gameRandom()*weighted.length)];
  }
  function forgeState(){return state.stats.forge||(state.stats.forge={rerolls:3,banishes:3,holds:2,bloodTrades:0,banished:[],kept:''});}
  const isTotemChoice=kind=>kind==='totem'||kind==='endless';
  function choiceLevel(u,kind){return isTotemChoice(kind)?(state.totems[u.id]||0):(u.level?u.level():upCount(u.id));}
  function getChoices(kind,options={}) {
    const forge=forgeState(),excluded=new Set(options.exclude||[]),banished=new Set(forge.banished||[]);let pool=choicePool(kind).filter(u=>{
      const lvl=choiceLevel(u,kind);return lvl<(u.max||99)&&(!u.when||u.when())&&!excluded.has(u.id)&&(kind!=='level'||!banished.has(u.id)&&hasUpgradeSlot(u)&&itemUnlockedForBuild(u));
    });
    if(kind==='level'){
      if(state.challenge==='inferno')pool=pool.filter(u=>u.type!=='ОРУЖИЕ'||u.id==='firetrail');
      pool=pool.filter(u=>state.stats.level>=8||u.rarity!=='legendary');
      pool.push(...evolutionUpgrades.filter(u=>(state.challenge!=='inferno'||u.weapon==='firetrail')&&(!u.when||u.when())&&!excluded.has(u.id)&&!banished.has(u.id)));
      const ordinaryRemains=upgrades.some(u=>choiceLevel(u,kind)<(u.max||99)&&(!u.when||u.when())&&!banished.has(u.id)&&hasUpgradeSlot(u)&&itemUnlockedForBuild(u)&&(state.challenge!=='inferno'||u.type!=='ОРУЖИЕ'||u.id==='firetrail')&&(state.stats.level>=8||u.rarity!=='legendary'))||evolutionUpgrades.some(u=>(state.challenge!=='inferno'||u.weapon==='firetrail')&&(!u.when||u.when())&&!banished.has(u.id));
      if(!pool.length&&!ordinaryRemains)pool=riftResonanceUpgrades.filter(u=>choiceLevel(u,kind)<(u.max||9999)&&(!u.when||u.when())&&!excluded.has(u.id)&&!banished.has(u.id));
    }
    const out=[];
    if(kind==='level'&&options.consumeKept!==false&&forge.kept){const held=pool.find(u=>u.id===forge.kept);forge.kept='';if(held){out.push(held);pool=pool.filter(u=>u.id!==held.id);}}
    if(kind==='level'){const evolution=pool.find(u=>u.type==='ЭВОЛЮЦИЯ');if(evolution&&!out.some(u=>u.id===evolution.id)){out.push(evolution);pool=pool.filter(u=>u.id!==evolution.id);}}
    const targetCount=kind==='boss'&&state.hero==='cursed'?4:3;while(out.length<targetCount&&pool.length){const u=weightedChoice(pool);if(!u)break;out.push(u);pool=pool.filter(x=>x.id!==u.id);}
    return out;
  }
  function applyChoiceItem(u,kind){if(kind==='level'&&!hasUpgradeSlot(u))return false;u.apply();if(isTotemChoice(kind))state.totems[u.id]=(state.totems[u.id]||0)+1;else state.relics[u.id]=(state.relics[u.id]||0)+1;return true;}
  function pickedChoiceMessage(u,kind){if(isTotemChoice(kind))return`<b>${u.name}</b> принят — награды усилены`;if(u.id==='riftWeapon'&&state.stats.riftLastWeapon){const weapon=WEAPON_INFO[state.stats.riftLastWeapon];return`<b>${u.name}</b> · ${weapon?.name||state.stats.riftLastWeapon} получает +1,5% урона`;}return`<b>${u.name}</b> усилено`;}
  const CHOICE_STAT_META={
    damageMult:['СИЛА УРОНА','number'],fireRate:['ТЕМП АТАК','mult'],projectiles:['СНАРЯДЫ','int'],crit:['ШАНС КРИТА','percent'],critMult:['КРИТ-УРОН','mult'],pierce:['ПРОБИТИЕ','int'],maxHp:['МАКСИМАЛЬНОЕ HP','int'],hp:['ТЕКУЩЕЕ HP','int'],armor:['БРОНЯ','number'],regen:['РЕГЕНЕРАЦИЯ','number'],speed:['СКОРОСТЬ ДВИЖЕНИЯ','mult'],pickup:['РАДИУС СБОРА','mult'],xpMult:['ПОЛУЧАЕМЫЙ ОПЫТ','mult'],projSize:['РАЗМЕР АТАК','mult'],projSpeed:['СКОРОСТЬ СНАРЯДОВ','mult'],projectileDamage:['УРОН СНАРЯДОВ','mult'],duration:['ДЛИТЕЛЬНОСТЬ','mult'],lifesteal:['ВАМПИРИЗМ','percent'],shieldMax:['ЗАРЯДЫ ЩИТА','int'],dropLuck:['ШАНС РАСХОДНИКОВ','percent'],killNova:['РЕАКТОР БОЙНИ','rank'],corpseFire:['ОГНЕННЫЕ ЛУЖИ','rank'],desperation:['УРОН ПРИ НИЗКОМ HP','rank'],chainBonus:['ПРЫЖКИ МОЛНИИ','rank'],bossSlayer:['УРОН БОССАМ','rank'],crowdPower:['ДАВЛЕНИЕ ТОЛПЫ','rank'],levelHeal:['ЛЕЧЕНИЕ ЗА УРОВЕНЬ','rank'],burnPower:['ОГНЕННЫЙ УРОН','rank'],revives:['ВОЗРОЖДЕНИЯ','int'],execute:['ПОРОГ КАЗНИ','percent'],thorns:['ОТВЕТНЫЙ УРОН','number'],echo:['ШАНС ЭХА','percent'],critExplosion:['КРИТИЧЕСКАЯ МАССА','rank'],feedback:['ПЕТЛЯ ОБРАТНОЙ СВЯЗИ','rank'],blood:['КРОВАВАЯ БАТАРЕЯ','rank'],levelPower:['КОРОНА ЭКСПОНЕНТЫ','rank'],inertiaFlywheel:['ИНЕРЦИОННЫЙ МАХОВИК','rank'],hunterAnchor:['ЯКОРЬ ОХОТНИКА','rank'],thermoSiphon:['ТЕРМОСИФОН','rank'],dischargeCap:['РАЗРЯДНЫЙ КОНДЕНСАТОР','rank'],cryoCapillary:['КРИОКАПИЛЛЯР','rank'],emergencyTeleport:['АВАРИЙНЫЙ ТЕЛЕПОРТ','rank'],pocketForge:['КАРМАННАЯ КУЗНИЦА','rank'],shardAccumulator:['ОСКОЛОЧНЫЙ НАКОПИТЕЛЬ','rank'],blackPowder:['ЧЁРНЫЙ ПОРОХ','rank'],riftStabilizer:['СТАБИЛИЗАТОР РАЗЛОМА','rank'],gildedLure:['ПОЗОЛОЧЕННАЯ ПРИМАНКА','rank'],soulCollector:['СБОРЩИК ДУШ','rank'],reversedClock:['ПЕРЕВЁРНУТЫЕ ЧАСЫ','rank'],pursuitMark:['МЕТКА ПРЕСЛЕДОВАНИЯ','rank'],unstableDuplicator:['НЕСТАБИЛЬНЫЙ ДУБЛИКАТОР','rank'],bloodContract:['КРОВАВЫЙ КОНТРАКТ','rank'],cleanupProtocol:['ПРОТОКОЛ ЗАЧИСТКИ','rank']
  };
  function choiceStatValue(field,value){const type=CHOICE_STAT_META[field]?.[1]||'number';if(type==='percent')return`${(value*100).toFixed(Math.abs(value*100)>=10?0:2)}%`;if(type==='mult')return`×${value.toFixed(2)}`;if(type==='int')return String(Math.round(value));if(type==='rank')return`ранг ${Math.round(value)}`;return Number(value).toFixed(Math.abs(value)>=10?0:2);}
  function choiceStatsSnapshot(){const snapshot={};for(const field of Object.keys(CHOICE_STAT_META))if(Number.isFinite(Number(state.stats[field])))snapshot[field]=Number(state.stats[field]);return snapshot;}
  function simulatedChoiceRows(u){
    const saved={stats:state.stats,weapons:state.weapons,cooldowns:state.cooldowns,relics:state.relics,difficulty:state.difficulty,buffs:state.buffs},before=choiceStatsSnapshot();let after={};try{state.stats=structuredClone(saved.stats);state.weapons={...saved.weapons};state.cooldowns={...saved.cooldowns};state.relics={...saved.relics};state.difficulty={...saved.difficulty};state.buffs={...saved.buffs};u.apply();after=choiceStatsSnapshot();}catch(_error){after={};}finally{state.stats=saved.stats;state.weapons=saved.weapons;state.cooldowns=saved.cooldowns;state.relics=saved.relics;state.difficulty=saved.difficulty;state.buffs=saved.buffs;}
    return Object.entries(CHOICE_STAT_META).filter(([field])=>Number.isFinite(before[field])&&Number.isFinite(after[field])&&Math.abs(after[field]-before[field])>1e-8).slice(0,5).map(([field,[label]])=>({label,before:choiceStatValue(field,before[field]),after:choiceStatValue(field,after[field])}));
  }
  function codexFormulaValue(formula,label,level){
    if(!formula||/урона врага|до |за |максимум|бонус от/.test(formula.toLocaleLowerCase('ru')))return null;const bonus=/снаряд/i.test(label)?state.stats.projectiles:/пробит/i.test(label)?state.stats.pierce:0,percent=formula.includes('%'),seconds=formula.includes('сек');let expression=formula.replaceAll('L',String(level)).replace(/бонус снарядов/gi,String(extraProjectileCount())).replace(/бонус героя/gi,String(bonus)).replace(/темп/gi,String(state.stats.fireRate)).replace(/(\d),(\d)/g,'$1.$2').replaceAll('×','*').replaceAll('−','-').replaceAll(';',',').replaceAll('%','').replace(/сек/gi,'').trim();
    for(let pass=0;pass<3;pass++)expression=expression.replace(/⌊([^⌊⌋]+)⌋/g,'Math.floor($1)');expression=expression.replace(/\bmin\(/gi,'Math.min(').replace(/\bmax\(/gi,'Math.max(');const safe=expression.replace(/Math\.(?:floor|min|max)/g,'');if(!/^[0-9+\-*/().,\s]+$/.test(safe))return null;try{const value=Function(`"use strict";return (${expression})`)();if(!Number.isFinite(value))return null;return{value,unit:percent?'%':seconds?' с':''};}catch(_error){return null;}
  }
  function formatCodexPreview(value){if(!value)return'';const number=value.value;return`${number.toFixed(Math.abs(number)>=100?0:Math.abs(number)>=10?1:2)}${value.unit}`;}
  function weaponChoiceRows(u){
    const current=state.weapons[u.id]||0,next=Math.min(u.max||8,current+1),rows=[{label:'УРОВЕНЬ ОРУЖИЯ',before:current?String(current):'нет',after:String(next)}],stats=CODEX_WEAPONS[u.id]?.stats||[];for(const [label,formula] of stats){const before=current?codexFormulaValue(formula,label,current):null,after=codexFormulaValue(formula,label,next);if(!after||current&&before&&Math.abs(after.value-before.value)<1e-8)continue;rows.push({label:label.toLocaleUpperCase('ru'),before:current&&before?formatCodexPreview(before):'—',after:formatCodexPreview(after)});if(rows.length>=5)break;}if(rows.length===1)for(const impact of (CODEX_WEAPONS[u.id]?.impacts||[]).slice(0,4))rows.push({label:impact.toLocaleUpperCase('ru'),before:'—',after:'улучшится'});return rows;
  }
  function choicePreviewHTML(u,kind){
    if(isTotemChoice(kind))return'';if(u.type==='ЭВОЛЮЦИЯ'){const effects=(CODEX_EVOLUTION_STATS[u.id]||[]).slice(0,5);return effects.length?`<div class="choice-preview"><strong>ПОСЛЕ ВЫБОРА</strong>${effects.map(effect=>`<div class="choice-preview-note">• ${effect}</div>`).join('')}</div>`:'';}if(u.type==='РЕЗОНАНС РАЗЛОМА')return`<div class="choice-preview"><strong>РЕЗОНАНС И ЦЕНА</strong>${(u.preview||[]).map(([label,value])=>`<div class="choice-preview-row"><span>${label}</span><b><i>${value}</i></b></div>`).join('')}</div>`;let rows=u.type==='ОРУЖИЕ'?weaponChoiceRows(u):simulatedChoiceRows(u);if(!rows.length)rows=(CODEX_ITEM_IMPACTS[u.id]||[]).slice(0,4).map(label=>({label:label.toLocaleUpperCase('ru'),before:'текущий ранг',after:'усилится'}));return rows.length?`<div class="choice-preview"><strong>ХАРАКТЕРИСТИКИ ПОСЛЕ ВЫБОРА</strong>${rows.map(row=>`<div class="choice-preview-row"><span>${row.label}</span><b>${row.before} → <i>${row.after}</i></b></div>`).join('')}</div>`:'';
  }
  function renderSoloChoiceCards(){
    $('#choiceCards').classList.toggle('four-choices',currentChoices.length===4);
    $('#choiceCards').innerHTML=currentChoices.map((u,i)=>{const r=rarityStyle[u.rarity],lvl=choiceLevel(u,choiceKind),unlocks=choiceKind==='level'?itemsUnlockedByChoice(u):[],evolutionHints=choiceKind==='level'?evolutionHintsForChoice(u):[];return `<button class="choice-card${unlocks.length?' has-unlocks':''}${evolutionHints.length?' has-evolution-hint':''}" data-index="${i}" style="--rarity:${r.color};--glow:${r.glow}"><span class="choice-num">${i+1}</span><div class="choice-icon">${u.icon}</div><span class="choice-type">${r.label} · ${u.type}</span><h3>${u.name}</h3><p>${u.desc()}</p>${evolutionHints.length?`<div class="choice-evolutions"><b>РЕЦЕПТ ЭВОЛЮЦИИ</b>${evolutionHints.map(hint=>`<span><i>${hint.weapon?.icon||'◆'}</i><strong>${hint.weapon?.name||hint.evolution.weapon} · ур. ${hint.weaponLevel}/8</strong><em>→ ${hint.evolution.name}${hint.ready?' · ГОТОВО':''}</em></span>`).join('')}</div>`:''}${unlocks.length?`<div class="choice-unlocks"><b>РАЗБЛОКИРУЕТ ПРЕДМЕТЫ</b><span>${unlocks.map(item=>item.name).join(' · ')}</span></div>`:''}${choicePreviewHTML(u,choiceKind)}<span class="level-up">${isTotemChoice(choiceKind)?(lvl?`СТУПЕНЬ ${lvl} → ${lvl+1}`:'АКТИВИРОВАТЬ'):(lvl?`УРОВЕНЬ ${lvl} → ${lvl+1}`:'НОВОЕ ОТКРЫТИЕ')}</span></button>`;}).join('');
    $$('.choice-card').forEach(card=>card.addEventListener('click',()=>pickChoice(Number(card.dataset.index))));
  }
  function updateSoloChoiceActions(){
    const panel=$('#choiceActions'),forge=forgeState(),enabled=choiceKind==='level';panel.classList.toggle('hidden',!enabled);panel.dataset.mode=choiceActionMode;
    if(!enabled)return;const reroll=panel.querySelector('[data-choice-action="reroll"]'),banish=panel.querySelector('[data-choice-action="banish"]'),hold=panel.querySelector('[data-choice-action="hold"]'),blood=panel.querySelector('[data-choice-action="blood"]');
    reroll.textContent=`ПЕРЕБРОС · ${forge.rerolls}`;reroll.disabled=forge.rerolls<=0;banish.textContent=choiceActionMode==='banish'?'ВЫБЕРИ КАРТУ ДЛЯ ИЗГНАНИЯ':`ИЗГНАТЬ · ${forge.banishes}`;banish.disabled=forge.banishes<=0;hold.textContent=choiceActionMode==='hold'?'ВЫБЕРИ КАРТУ ДЛЯ СОХРАНЕНИЯ':`СОХРАНИТЬ · ${forge.holds}`;hold.disabled=forge.holds<=0;const cost=Math.max(1,Math.ceil(state.stats.maxHp*.2));blood.textContent=`ЕЩЁ ВЫБОР ЗА ${cost} HP`;blood.disabled=state.hardcore||forge.bloodTrades>=3||state.stats.hp<=cost;
  }
  function openChoice(kind='level', chained=false) {
    // A chained level-up is opened while the simulation deliberately remains
    // frozen. Previously we briefly switched back to `playing` between cards;
    // nearby XP could then add new levels faster than the queue was consumed.
    if(state.mode!=='playing'&&!(chained&&state.mode==='choice'))return;
    choiceKind=kind==='chest'?'boss':kind;choiceActionMode='';state.mode='choice';releaseCameraPointerLock();currentChoices=getChoices(choiceKind,{consumeKept:true});
    if(!currentChoices.length){if(choiceKind==='level')pendingLevels=0;if(choiceKind==='boss')pendingChests=0;state.mode='playing';$('#choiceScreen').classList.add('hidden');requestCameraPointerLock();return;}
    const boss=choiceKind==='boss',endless=choiceKind==='endless',resonance=choiceKind==='level'&&currentChoices.every(u=>u.type==='РЕЗОНАНС РАЗЛОМА');$('#choiceKicker').textContent=choiceKind==='totem'?'ПРОБУЖДЕНИЕ ТОТЕМА':endless?'БЕСКОНЕЧНЫЙ РАЗЛОМ':boss?'СЕРДЦЕ ПОВЕРЖЕННОГО БОССА':resonance?'ОБЫЧНЫЕ УЛУЧШЕНИЯ ИСЧЕРПАНЫ':pendingLevels>1?`ЕЩЁ ВЫБОРОВ: ${pendingLevels}`:`УРОВЕНЬ ${state.stats.level}`;
    $('#choiceTitle').textContent=choiceKind==='totem'?'ВЫБЕРИ СВОЁ ПРОКЛЯТИЕ':endless?'ПРИМИ ФИНАЛЬНЫЙ ТОТЕМ':boss?'ВЫБЕРИ УНИКАЛЬНУЮ РЕЛИКВИЮ':resonance?'РЕЗОНАНС РАЗЛОМА':'ВЫБЕРИ УСИЛЕНИЕ';
    $('#choiceSubtitle').textContent=choiceKind==='totem'?'Сложность растёт навсегда, но вместе с ней растёт опыт.':endless?'Теперь каждый выбор рассчитан на уже сломанный билд.':boss?'Эти реликвии невозможно получить при обычном повышении уровня.':resonance?'Каждый выбор усиливает билд, но одновременно повышает здоровье и скорость врагов.':`Оружие ${equippedWeaponIds().length}/${currentWeaponSlotLimit()} · предметы ${equippedItemIds().length}/${ITEM_SLOT_LIMIT}. Повторный выбор повышает ранг.`;
    renderSoloChoiceCards();updateSoloChoiceActions();$('#choiceScreen').classList.remove('hidden');audio.tone(boss?760:540,.18,'triangle',.04);
  }
  function soloChoiceAction(action){
    if(state.mode!=='choice'||choiceKind!=='level')return;const forge=forgeState();
    if(action==='reroll'&&forge.rerolls>0){forge.rerolls--;choiceActionMode='';const old=currentChoices.map(u=>u.id),next=getChoices('level',{consumeKept:false,exclude:old});currentChoices=next.length?next:getChoices('level',{consumeKept:false});renderSoloChoiceCards();updateSoloChoiceActions();audio.tone(330,.1,'triangle',.025);return;}
    if(action==='banish'&&forge.banishes>0){choiceActionMode=choiceActionMode==='banish'?'':'banish';updateSoloChoiceActions();return;}
    if(action==='hold'&&forge.holds>0){choiceActionMode=choiceActionMode==='hold'?'':'hold';updateSoloChoiceActions();return;}
    if(action==='blood'){const cost=Math.max(1,Math.ceil(state.stats.maxHp*.2));if(state.hardcore||forge.bloodTrades>=3||state.stats.hp<=cost)return;state.stats.hp-=cost;state.stats.damageTaken+=cost;forge.bloodTrades++;pendingLevels++;updateSoloChoiceActions();updateUI(true);toast(`<b>КРОВАВАЯ ПЕРЕКОВКА</b> · ещё один выбор за ${cost} HP`,'#ff3f68');}
  }
  function pickChoice(i) {
    if(state.mode!=='choice'||!currentChoices[i])return;const u=currentChoices[i];
    if(choiceKind==='level'&&choiceActionMode){const forge=forgeState();if(['ЭВОЛЮЦИЯ','РЕЗОНАНС РАЗЛОМА'].includes(u.type)&&choiceActionMode==='banish'){toast(u.type==='ЭВОЛЮЦИЯ'?'Эволюцию нельзя изгнать — она уже заслужена':'Резонанс нельзя изгнать — это бесконечная поздняя ветка','#63ffb0');choiceActionMode='';updateSoloChoiceActions();return;}if(choiceActionMode==='banish'&&forge.banishes>0){forge.banishes--;if(!forge.banished.includes(u.id))forge.banished.push(u.id);toast(`<b>${u.name}</b> изгнано до конца забега`,'#ff708b');}else if(choiceActionMode==='hold'&&forge.holds>0){forge.holds--;forge.kept=u.id;toast(`<b>${u.name}</b> сохранено до следующего уровня`,'#63ffb0');}choiceActionMode='';currentChoices=getChoices('level',{consumeKept:false,exclude:[u.id]});renderSoloChoiceCards();updateSoloChoiceActions();return;}
    const pickedKind=choiceKind;if(!applyChoiceItem(u,pickedKind)){toast('Свободных слотов для нового усиления нет','#ff708b');currentChoices=getChoices(pickedKind,{consumeKept:false,exclude:[u.id]});renderSoloChoiceCards();return;}
    $('#choiceScreen').classList.add('hidden');updateSlots();toast(pickedChoiceMessage(u,pickedKind),rarityStyle[u.rarity].color);audio.tone(isTotemChoice(pickedKind)?105:460+i*90,.16,isTotemChoice(pickedKind)?'sawtooth':'square',.04);
    if(pickedKind==='level'&&pendingLevels>0)pendingLevels--;
    if(pickedKind==='boss'&&pendingChests>0)pendingChests--;
    if(pendingChests>0)setTimeout(()=>openChoice('boss',true),90);
    else if(pendingLevels>0)setTimeout(()=>openChoice('level',true),90);
    else{pendingLevels=0;pendingChests=0;state.mode='playing';requestCameraPointerLock();}
  }
  function isCoop(){return coopNet.mode==='host'||coopNet.mode==='guest';}
  function isCoopHost(){return coopNet.mode==='host';}
  function choiceData(u,kind){
    const r=rarityStyle[u.rarity],lvl=choiceLevel(u,kind);
    return{id:u.id,name:u.name,icon:u.icon,type:u.type,rarity:u.rarity,rarityLabel:r.label,color:r.color,desc:u.desc(),levelText:isTotemChoice(kind)?(lvl?`СТУПЕНЬ ${lvl} → ${lvl+1}`:'АКТИВИРОВАТЬ'):(lvl?`УРОВЕНЬ ${lvl} → ${lvl+1}`:'НОВОЕ ОТКРЫТИЕ')};
  }
  function compactChoiceMeta(){const forge=forgeState();return{forge:{...forge,banished:[...(forge.banished||[])]},hp:state.stats.hp,maxHp:state.stats.maxHp,hardcore:state.hardcore};}
  function renderCompactChoice(kind,choices,remote=false,mode='',meta=null){
    releaseCameraPointerLock();
    const boss=kind==='boss'||kind==='chest',endless=kind==='endless';$('#coopChoiceKicker').textContent=kind==='totem'?'ПРОБУЖДЕНИЕ ТОТЕМА':endless?'БЕСКОНЕЧНЫЙ РАЗЛОМ':boss?'РЕЛИКВИЯ БОССА':'НОВЫЙ УРОВЕНЬ';
    $('#coopChoicePanel strong').textContent=kind==='totem'?'ВЫБЕРИ ПРОКЛЯТИЕ':endless?'ФИНАЛЬНЫЙ ТОТЕМ':boss?'ВЫБЕРИ УНИКАЛЬНУЮ РЕЛИКВИЮ':mode==='banish'?'ВЫБЕРИ, ЧТО ИЗГНАТЬ':mode==='hold'?'ВЫБЕРИ, ЧТО СОХРАНИТЬ':'ВЫБЕРИ УСИЛЕНИЕ';
    $('#coopChoiceCards').innerHTML=choices.map((u,i)=>`<button class="coop-choice-card" data-index="${i}" style="--rarity:${u.color}"><kbd>${i+1}</kbd><span>${u.icon}</span><div><b>${u.name}</b><small>${u.desc}</small><em>${u.levelText}</em></div></button>`).join('');
    $$('.coop-choice-card').forEach(card=>card.addEventListener('click',()=>remote?sendGuestChoice(Number(card.dataset.index)):pickCompactChoice(Number(card.dataset.index))));
    const actions=$('#coopChoiceActions');actions.classList.toggle('hidden',kind!=='level');if(kind==='level'){const forge=meta?.forge||forgeState(),maxHp=meta?.maxHp??state.stats.maxHp,hp=meta?.hp??state.stats.hp,hardcore=meta?.hardcore??state.hardcore,cost=Math.max(1,Math.ceil(maxHp*.2));actions.querySelector('[data-choice-action="reroll"]').textContent=`↻ ${forge.rerolls}`;actions.querySelector('[data-choice-action="banish"]').textContent=mode==='banish'?'ИЗГНАНИЕ…':`⊘ ${forge.banishes}`;actions.querySelector('[data-choice-action="hold"]').textContent=mode==='hold'?'СОХРАНЕНИЕ…':`▣ ${forge.holds}`;actions.querySelector('[data-choice-action="blood"]').textContent=`♥−${cost}`;actions.querySelector('[data-choice-action="reroll"]').disabled=forge.rerolls<=0;actions.querySelector('[data-choice-action="banish"]').disabled=forge.banishes<=0;actions.querySelector('[data-choice-action="hold"]').disabled=forge.holds<=0;actions.querySelector('[data-choice-action="blood"]').disabled=hardcore||forge.bloodTrades>=3||hp<=cost;}
    $('#coopChoicePanel').classList.remove('hidden');audio.tone(boss?720:540,.12,'triangle',.025);
  }
  function openCompactChoice(kind='level'){
    const actor=actorById(activeActorId);if(state.mode!=='playing'||!actor||actor.choice)return;
    kind=kind==='chest'?'boss':kind;choiceKind=kind;currentChoices=getChoices(kind,{consumeKept:true});
    if(!currentChoices.length){if(kind==='level')pendingLevels=0;if(kind==='boss')pendingChests=0;if(kind==='totem')actor.pendingTotems=0;if(kind==='endless')actor.pendingEndless=0;return;}
    const choices=currentChoices.map(u=>choiceData(u,kind));actor.choice={kind,ids:choices.map(u=>u.id),mode:''};
    if(actor.local)renderCompactChoice(kind,choices);else sendCoop({type:'choice-offer',actorId:actor.id,kind,choices,mode:'',meta:compactChoiceMeta()});
  }
  function requestChoice(kind='level'){
    if(!isCoopHost()){openChoice(kind);return;}
    const actor=actorById(activeActorId);if(!actor)return;
    if(kind==='totem')actor.pendingTotems=(actor.pendingTotems||0)+1;
    if(!actor.choice)openCompactChoice(kind);
  }
  function applyCompactChoice(actor,index){
    if(!actor?.choice)return;let picked=null,pickedKind=actor.choice.kind,reforged=false;
    withActor(actor,()=>{
      const u=findChoiceItem(actor.choice.ids[index],pickedKind);if(!u)return;const forge=forgeState();
      if(pickedKind==='level'&&actor.choice.mode){if(['ЭВОЛЮЦИЯ','РЕЗОНАНС РАЗЛОМА'].includes(u.type)&&actor.choice.mode==='banish'){actor.choice.mode='';reforged=true;return;}if(actor.choice.mode==='banish'&&forge.banishes>0){forge.banishes--;if(!forge.banished.includes(u.id))forge.banished.push(u.id);}else if(actor.choice.mode==='hold'&&forge.holds>0){forge.holds--;forge.kept=u.id;}actor.choice.mode='';actor.choice.ids=getChoices('level',{consumeKept:false,exclude:[u.id]}).map(item=>item.id);reforged=true;return;}
      if(!applyChoiceItem(u,pickedKind))return;picked=u;if(pickedKind==='totem')actor.pendingTotems=Math.max(0,(actor.pendingTotems||0)-1);if(pickedKind==='endless')actor.pendingEndless=Math.max(0,(actor.pendingEndless||0)-1);
      if(pickedKind==='level')pendingLevels=Math.max(0,pendingLevels-1);if(pickedKind==='boss')pendingChests=Math.max(0,pendingChests-1);
      actor.choice=null;currentChoices=[];
    });
    if(reforged){resendActorChoice(actor);return;}
    if(!picked)return;
    if(actor.local){$('#coopChoicePanel').classList.add('hidden');$('#coopChoicePanel').classList.remove('waiting');updateSlots();toast(pickedChoiceMessage(picked,pickedKind),rarityStyle[picked.rarity].color);}else sendCoop({type:'event',event:'choice-picked',actorId:actor.id});
    audio.tone(isTotemChoice(pickedKind)?105:460+index*90,.12,isTotemChoice(pickedKind)?'sawtooth':'square',.025);
    const next=actor.pendingEndless>0?'endless':actor.pendingTotems>0?'totem':actor.pendingChests>0?'boss':actor.pendingLevels>0?'level':'';
    if(next)setTimeout(()=>withActor(actor,()=>openCompactChoice(next)),70);else if(actor.local)requestCameraPointerLock();
  }
  function compactChoiceAction(actor,action){
    if(!actor?.choice||actor.choice.kind!=='level')return;withActor(actor,()=>{const forge=forgeState();if(action==='reroll'&&forge.rerolls>0){forge.rerolls--;const old=actor.choice.ids,choices=getChoices('level',{consumeKept:false,exclude:old});actor.choice.ids=(choices.length?choices:getChoices('level',{consumeKept:false})).map(u=>u.id);actor.choice.mode='';}else if(action==='banish'&&forge.banishes>0)actor.choice.mode=actor.choice.mode==='banish'?'':'banish';else if(action==='hold'&&forge.holds>0)actor.choice.mode=actor.choice.mode==='hold'?'':'hold';else if(action==='blood'){const cost=Math.max(1,Math.ceil(state.stats.maxHp*.2));if(state.hardcore||forge.bloodTrades>=3||state.stats.hp<=cost)return;state.stats.hp-=cost;state.stats.damageTaken+=cost;forge.bloodTrades++;pendingLevels++;}});resendActorChoice(actor);
  }
  function pickCompactChoice(index){if(!isCoopHost())return;const actor=coopActors.find(item=>item.local);applyCompactChoice(actor,index);}
  function sendGuestChoice(index){
    if(coopNet.mode!=='guest'||$('#coopChoicePanel').classList.contains('hidden'))return;sendCoop({type:'choice',index});$$('.coop-choice-card').forEach(card=>card.disabled=true);$('#coopChoicePanel').classList.add('hidden');$('#coopChoicePanel').classList.add('waiting');requestCameraPointerLock();
  }
  function resendActorChoice(actor){if(!actor?.choice)return;withActor(actor,()=>{const choices=actor.choice.ids.map(id=>findChoiceItem(id,actor.choice.kind)).filter(Boolean).map(item=>choiceData(item,actor.choice.kind));if(actor.local)renderCompactChoice(actor.choice.kind,choices,false,actor.choice.mode||'');else sendCoop({type:'choice-offer',actorId:actor.id,kind:actor.choice.kind,choices,mode:actor.choice.mode||'',meta:compactChoiceMeta()});});}
  $('#choiceActions').addEventListener('click',event=>{const button=event.target.closest('[data-choice-action]');if(button)soloChoiceAction(button.dataset.choiceAction);});
  $('#coopChoiceActions').addEventListener('click',event=>{const button=event.target.closest('[data-choice-action]');if(!button)return;const action=button.dataset.choiceAction;if(coopNet.mode==='guest')sendCoop({type:'choice-action',action});else compactChoiceAction(coopActors.find(actor=>actor.local),action);});

  // ---------- Enemies, attacks and progression ----------
  const ENEMY_TYPES = {
    grunt:{hp:22,speed:2.45,damage:10,size:.85,color:[.85,.12,.28,1],xp:1},
    runner:{hp:15,speed:4.2,damage:8,size:.62,color:[1,.42,.12,1],xp:1},
    brute:{hp:95,speed:1.55,damage:19,size:1.32,color:[.55,.12,.78,1],xp:4},
    swarm:{hp:9,speed:3.25,damage:6,size:.43,color:[.95,.18,.58,1],xp:1},
    titan:{hp:290,speed:1.25,damage:30,size:1.75,color:[.2,.75,.66,1],xp:12},
    charger:{hp:30,speed:2.7,damage:16,size:.76,color:[1,.3,.08,1],xp:2},
    shooter:{hp:38,speed:2.05,damage:13,size:.76,color:[.42,.2,1,1],xp:2},
    warden:{hp:135,speed:1.42,damage:21,size:1.25,color:[.14,.55,.92,1],xp:5},
    splitter:{hp:54,speed:2.15,damage:13,size:.96,color:[.92,.16,.68,1],xp:3},
    burrower:{hp:58,speed:3.15,damage:18,size:.82,color:[.95,.34,.08,1],xp:3},
    phaser:{hp:52,speed:3.45,damage:15,size:.78,color:[.58,.24,1,1],xp:3},
    standard:{hp:112,speed:1.85,damage:13,size:1.08,color:[1,.63,.08,1],xp:5},
    absorber:{hp:148,speed:1.62,damage:20,size:1.22,color:[.12,.58,.9,1],xp:6}
  };
  const ENEMY_NAMES={grunt:'РЯДОВОЙ РАЗЛОМА',runner:'БЕГУН',brute:'ГРОМИЛА',swarm:'ТВАРЬ РОЯ',titan:'ТИТАН',charger:'ТАРАН',shooter:'СТРЕЛОК',warden:'ЗНАМЕНОСЕЦ',splitter:'ДЕЛИТЕЛЬ',burrower:'ПОДКОПЩИК',phaser:'ФАЗОВЫЙ ОХОТНИК',standard:'ЗНАМЕНОСЕЦ',absorber:'ПОГЛОТИТЕЛЬ'};
  const BOSS_ARCHETYPES = {
    breaker:{name:'РАЗРЫВАТЕЛЬ БЕЗДНЫ',type:'titan',color:[1,.15,.5,1],health:1,speed:1,size:1,canDash:true,canWave:true,canVolley:true},
    worm:{name:'ЧЕРВЬ БЕЗДНЫ',type:'burrower',color:[1,.38,.06,1],health:.92,speed:1.18,size:1.18,canDash:false,canWave:false,canVolley:false},
    architect:{name:'АРХИТЕКТОР РАЗЛОМА',type:'warden',color:[.22,.58,1,1],health:1.12,speed:.88,size:1.08,canDash:false,canWave:false,canVolley:true},
    swarmking:{name:'КОРОЛЬ РОЯ',type:'splitter',color:[1,.12,.72,1],health:.96,speed:1.08,size:1.12,canDash:false,canWave:true,canVolley:false},
    mirror:{name:'ЗЕРКАЛЬНЫЙ ТИТАН',type:'phaser',color:[.72,.35,1,1],health:1.04,speed:1.12,size:1.15,canDash:true,canWave:false,canVolley:false}
  };
  const ELITE_AFFIXES = [
    {id:'armored',name:'БРОНИРОВАННЫЙ',color:[.45,.72,1,1]},
    {id:'relentless',name:'НЕУДЕРЖИМЫЙ',color:[1,.58,.09,1]},
    {id:'vampiric',name:'ВАМПИРИЧЕСКИЙ',color:[1,.08,.23,1]},
    {id:'volatile',name:'ВЗРЫВАЮЩИЙСЯ',color:[.58,.25,1,1]}
  ];
  const NET_ENEMY_TYPES=Object.keys(ENEMY_TYPES),NET_AFFIXES=ELITE_AFFIXES.map(affix=>affix.id),NET_BOSS_KINDS=Object.keys(BOSS_ARCHETYPES);
  const NET_COLORS=[COLORS.cyan,COLORS.violet,COLORS.amber,COLORS.green,COLORS.white,COLORS.red,COLORS.pink];
  const NET_PROJECTILE_KINDS=['','saw','drone','boomerang','needle','nanite','reflected','shard'],NET_ZONE_KINDS=['pulse','frost','meteor','gravity','firetrail','blast','storm','riftScar','mine','mortar','seismic','enemyWarning','enemyBlast','enemyTrap'];
  const netRound=value=>Math.round((Number(value)||0)*100)/100;
  function netColorIndex(color){let direct=NET_COLORS.indexOf(color);if(direct>=0)return direct;let best=0,distance=Infinity;for(let i=0;i<NET_COLORS.length;i++){const candidate=NET_COLORS[i],score=(candidate[0]-(color?.[0]||0))**2+(candidate[1]-(color?.[1]||0))**2+(candidate[2]-(color?.[2]||0))**2;if(score<distance){distance=score;best=i;}}return best;}
  function netVisible(items,origin,limit,range=54,priority=()=>false){const range2=range*range,important=[],near=[];for(const item of items){if(priority(item)){important.push(item);continue;}const distance=dist2(item,origin);if(distance<range2)near.push([distance,item]);}near.sort((a,b)=>a[0]-b[0]);return important.concat(near.slice(0,Math.max(0,limit-important.length)).map(entry=>entry[1])).slice(0,limit);}
  function packEnemy(e){const flags=(e.elite?1:0)|(e.boss?2:0)|(e.miniboss?4:0)|(e.absorbActive?8:0);return[e.nid,netRound(e.x),netRound(e.z),Math.max(0,NET_ENEMY_TYPES.indexOf(e.type)),netRound(e.size),flags,Math.max(0,NET_AFFIXES.indexOf(e.affix)+1),Math.max(0,Math.round(e.hp)),Math.max(1,Math.round(e.maxHp)),e.shieldHits||0,netRound(e.chargeWindup),netRound(Math.min(.06,e.hit||0)),netRound(e.burrowWindup),netRound(e.bossDashWindup),netRound(e.bossWaveWindup),e.bossKind?Math.max(0,NET_BOSS_KINDS.indexOf(e.bossKind)+1):0,e.copiedWeapon?Math.max(0,Object.keys(WEAPON_INFO).indexOf(e.copiedWeapon)+1):0];}
  function unpackEnemy(row){const type=NET_ENEMY_TYPES[row[3]]||'grunt',flags=row[5]||0,affix=row[6]?NET_AFFIXES[row[6]-1]:'',affixInfo=ELITE_AFFIXES.find(item=>item.id===affix),bossKind=row[15]?NET_BOSS_KINDS[row[15]-1]:'',bossInfo=BOSS_ARCHETYPES[bossKind],copiedWeapon=row[16]?Object.keys(WEAPON_INFO)[row[16]-1]:'';return{nid:row[0],x:row[1],z:row[2],type,size:row[4],elite:Boolean(flags&1),boss:Boolean(flags&2),miniboss:Boolean(flags&4),absorbActive:Boolean(flags&8),affix,affixColor:affixInfo?.color||COLORS.white,bossKind,bossName:bossInfo?.name||'',copiedWeapon,color:flags&2?(bossInfo?.color||COLORS.pink):flags&4?(type==='warden'?[.18,.6,1,1]:[.92,.16,.68,1]):ENEMY_TYPES[type].color,hp:row[7],maxHp:row[8],shieldHits:row[9]||0,chargeWindup:row[10]||0,hit:row[11]||0,burrowWindup:row[12]||0,bossDashWindup:row[13]||0,bossWaveWindup:row[14]||0,seed:(row[0]%997)/37,dead:false};}
  const packProjectile=p=>[netRound(p.x),netRound(p.z),netRound(p.y),netRound(p.vx),netRound(p.vz),netRound(p.size),netColorIndex(p.color),Math.max(0,NET_PROJECTILE_KINDS.indexOf(p.kind||'')),netRound(p.spin),netRound(p.vy),p.aim3d?1:0];
  const unpackProjectile=row=>({x:row[0],z:row[1],y:row[2],vx:row[3],vz:row[4],size:row[5],color:NET_COLORS[row[6]]||COLORS.cyan,kind:NET_PROJECTILE_KINDS[row[7]]||'',spin:row[8]||0,vy:row[9]||0,aim3d:Boolean(row[10]),hit:new Set()});
  const packZone=zone=>[netRound(zone.x),netRound(zone.z),netRound(zone.radius),netRound(zone.life),netRound(zone.max),netColorIndex(zone.color),Math.max(0,NET_ZONE_KINDS.indexOf(zone.kind))];
  const unpackZone=row=>({x:row[0],z:row[1],radius:row[2],life:row[3],max:row[4],color:NET_COLORS[row[5]]||COLORS.cyan,kind:NET_ZONE_KINDS[row[6]]||'pulse'});
  function lateGamePhase(time=state.time) { const t=runTimelineTime(time);return t>=1200?2:t>=600?1:0; }
  function enemyTimeSpeed(time=state.time) { const t=runTimelineTime(time),power=state.difficulty?.scaling??1,endlessAge=Math.max(0,t-1800);return 1+(Math.min(.5,t/3600)+endlessAge/2400)*power; }
  function enemyGrowth(time=state.time,tier=state.threatTier) {
    const t=runTimelineTime(time),power=state.difficulty?.scaling??1,endlessAge=Math.max(0,t-1800),endlessHealth=(1+endlessAge/180)**1.8,endlessDamage=1+endlessAge/300,rawHealth=(1+t/150)**ENEMY_HEALTH_TIME_EXPONENT*(1+tier*.14)*endlessHealth,rawDamage=(1+t/600)*(1+tier*.045)*endlessDamage;
    return{health:1+(rawHealth-1)*power,damage:1+(rawDamage-1)*power*ENEMY_DAMAGE_SCALING_RATE,speed:(1+tier*.008*power)*enemyTimeSpeed(time),spawn:2+(t/135+tier*.65+endlessAge/22)*power};
  }
  function post15Scales(time=state.time) {
    const t=runTimelineTime(time);if(t<600)return{health:1,damage:1,spawn:1,speed:1};
    const strength=state.difficulty?.rift??1,from=t<900?{health:1,damage:1,spawn:1,speed:1}:t<1200?{health:1.65,damage:1.25,spawn:1.35,speed:1.08}:{health:2.5,damage:1.6,spawn:1.75,speed:1.15},to=t<900?{health:1.65,damage:1.25,spawn:1.35,speed:1.08}:t<1200?{health:2.5,damage:1.6,spawn:1.75,speed:1.15}:{health:4.2,damage:2.15,spawn:2.3,speed:1.27},ramp=t<900?(t-600)/300:t<1200?(t-900)/300:clamp((t-1200)/600,0,1),scaled={};
    for(const key of ['health','damage','spawn','speed'])scaled[key]=1+(lerp(from[key],to[key],ramp)-1)*strength*(key==='damage'?ENEMY_DAMAGE_SCALING_RATE:1);
    return scaled;
  }
  function scheduledBossTimes(){return CHALLENGES[state.challenge]?.bossRush?[180,480,780,1080,1380,1680]:[300,900,1500];}
  function lateBossHealthScale(time=state.time){
    const timeline=runTimelineTime(time),marks=scheduledBossTimes(),first=marks[0]??300,last=marks.at(-1)??1500,progress=clamp((timeline-first)/Math.max(1,last-first),0,1);
    return lerp(1,LATE_BOSS_MAX_HEALTH_SCALE,progress);
  }
  function bossActionTempo(time=state.time){const late=clamp((runTimelineTime(time)-300)/1200,0,1);return 1+late*.35+(state.adaptive?.pressure||0)*.15;}
  function expectedPlayerLevel(time=state.time){
    const rush=state.runPace==='rush',marks=rush?[[0,1],[60,11],[150,27],[300,70],[450,98],[600,105]]:[[0,1],[150,9],[300,17],[600,38],[900,70],[1200,98],[1800,106]],elapsed=Math.max(0,time),rewardFactor=Math.pow(clamp(state.difficulty?.reward??1,.5,4),.20);let expected=marks.at(-1)[1];
    if(elapsed<=marks.at(-1)[0]){for(let i=1;i<marks.length;i++){const previous=marks[i-1],next=marks[i];if(elapsed<=next[0]){expected=lerp(previous[1],next[1],clamp((elapsed-previous[0])/(next[0]-previous[0]),0,1));break;}}}else expected+=Math.max(0,elapsed-marks.at(-1)[0])*(rush?.35:.12)/60;
    return Math.max(1,1+(expected-1)*rewardFactor);
  }
  function adaptiveBuildPressure(time=state.time){
    const timeline=runTimelineTime(time),progress=clamp(timeline/1800,0,1),slots=currentWeaponSlotLimit(),evolutions=evolutionUpgrades.filter(item=>upCount(item.id)>0).length,maxed=Object.values(state.weapons).filter(level=>level>=8).length,bossRelicCount=bossRelics.filter(item=>upCount(item.id)>0).length,expectedBossRelics=scheduledBossTimes().filter(mark=>timeline>=mark).length+[600,1200].filter(mark=>timeline>=mark).length+(state.hero==='cursed'?1:0),evolutionAhead=clamp(evolutions/Math.max(1,slots)-progress,0,1),maxedAhead=clamp(maxed/Math.max(1,slots)-progress,0,1),bossAhead=clamp((bossRelicCount-expectedBossRelics)/2,0,1),s=state.stats||{},base=Math.max(.01,s.baseDamage||1),global=Math.max(1,((s.damageMult||base)+(s.bloodBonus||0)+(s.levelPowerBonus||0))/base),rate=Math.sqrt(Math.max(1,s.fireRate||1)),crit=1+clamp(s.crit||0,0,1.25)*Math.max(0,(s.critMult||1)-1)*.65,coverage=1+Math.min(6,Math.max(0,(s.projectiles||1)-1))*.14+Math.max(0,(s.projSize||1)-1)*.12,echo=1+(s.echo||0)*.65,projectile=Math.sqrt(Math.max(1,s.projectileDamage||1)),score=Math.log2(Math.max(1,global*rate*crit*coverage*echo*projectile)),expectedScore=.8+progress*3.7,offenseAhead=clamp((score-expectedScore)/2.2,0,1);
    return clamp(evolutionAhead*.32+maxedAhead*.12+bossAhead*.10+offenseAhead*.46,0,1);
  }
  function adaptiveDifficultyTarget(time=state.time){
    const adaptive=state.adaptive||{},expected=expectedPlayerLevel(time),actualCheckpoint=Math.floor((state.stats?.level||1)/5)*5,expectedCheckpoint=Math.floor(expected/5)*5,levelSpan=Math.max(15,expected*.18),levelAhead=clamp((actualCheckpoint-expectedCheckpoint)/levelSpan,0,1),levelBehind=clamp((expectedCheckpoint-actualCheckpoint)/levelSpan,0,1),build=adaptiveBuildPressure(time),baseSpawn=enemyGrowth(time).spawn*(state.difficulty?.spawn??1)*post15Scales(time).spawn,killRatio=(adaptive.killRate||0)/Math.max(1.5,baseSpawn),performance=clamp((killRatio-.65)/.35,0,1),living=enemies.filter(enemy=>!enemy.dead),nearRatio=living.filter(enemy=>dist2(player,enemy)<=8**2).length/Math.max(1,living.length),hpRatio=(state.stats?.hp||0)/Math.max(1,state.stats?.maxHp||1),dominant=killRatio>=1.05||(killRatio>=.85&&nearRatio<=.08&&hpRatio>=.75),stationary=runTimelineTime(time)>=360&&dominant?clamp(((player.stationaryTime||0)-2)/6,0,1):0,effectiveLevelBehind=dominant?0:levelBehind,healthRelief=levelBehind*(dominant?.10:.08),health=clamp(1+levelAhead*.28+build*.38+performance*.18+stationary*.20-healthRelief,.94,ADAPTIVE_HEALTH_MAX),damage=clamp(1+levelAhead*.07+build*.04+performance*.03+stationary*.04-effectiveLevelBehind*.02,.98,1.16),speed=clamp(1+build*.035+performance*.04+stationary*.08,1,1.14),eliteBonus=levelAhead*.05+build*.08+performance*.06+stationary*.05,threatWeight=Math.round((levelAhead+build+performance+stationary)*3),pressure=clamp(levelAhead*.34+build*.32+performance*.20+stationary*.14,0,1);
    return{expected,levelAhead,levelBehind,effectiveLevelBehind,build,performance,stationary,killRatio,nearRatio,dominant,health,damage,speed,eliteBonus,threatWeight,pressure};
  }
  function updateAdaptiveScaling(dt){
    const adaptive=state.adaptive;if(!adaptive||!state.stats)return;adaptive.sampleClock-=dt;adaptive.sampleElapsed+=dt;
    if(adaptive.sampleClock<=0){const kills=state.stats.kills||0,elapsed=Math.max(.1,adaptive.sampleElapsed),instant=Math.max(0,kills-(adaptive.lastKills||0))/elapsed;adaptive.killRate=adaptive.samples?lerp(adaptive.killRate||0,instant,.3):instant;adaptive.lastKills=kills;adaptive.sampleClock+=2;adaptive.sampleElapsed=0;adaptive.samples=(adaptive.samples||0)+1;}
    const target=adaptiveDifficultyTarget(),response=1-Math.exp(-dt/10),oldHealth=adaptive.health||1,oldDamage=adaptive.damage||1,oldSpeed=adaptive.speed||1,nextHealth=lerp(oldHealth,target.health,response),nextDamage=lerp(oldDamage,target.damage,response),nextSpeed=lerp(oldSpeed,target.speed,response);adaptive.health=clamp(target.dominant?Math.max(1,nextHealth):nextHealth,.94,ADAPTIVE_HEALTH_MAX);adaptive.damage=target.dominant?Math.max(1,nextDamage):nextDamage;adaptive.speed=target.dominant?Math.max(1,nextSpeed):nextSpeed;adaptive.eliteBonus=lerp(adaptive.eliteBonus||0,target.eliteBonus,response);adaptive.threatWeight=lerp(adaptive.threatWeight||0,target.threatWeight,response);adaptive.targetHealth=target.health;adaptive.targetDamage=target.damage;adaptive.targetSpeed=target.speed;adaptive.expectedLevel=target.expected;adaptive.levelPressure=target.levelAhead;adaptive.buildPressure=target.build;adaptive.performancePressure=target.performance;adaptive.stationaryPressure=target.stationary;adaptive.pressure=target.pressure;adaptive.dominant=target.dominant;
    const healthRatio=adaptive.health/oldHealth,damageRatio=adaptive.damage/oldDamage,speedRatio=adaptive.speed/oldSpeed;if(Math.abs(healthRatio-1)>.000001||Math.abs(damageRatio-1)>.000001||Math.abs(speedRatio-1)>.000001)for(const enemy of enemies){if(enemy.dead)continue;enemy.hp*=healthRatio;enemy.maxHp*=healthRatio;enemy.damage*=damageRatio;enemy.speed*=speedRatio;}
  }
  function updateBalanceTelemetry(dt){
    const balance=state.balance,s=state.stats;if(!TELEMETRY_ENABLED||!balance||!s)return;balance.activeTime+=dt;if(!player.moving)balance.stationaryTime+=dt;balance.fpsTotal+=1/Math.max(1/240,dt);balance.fpsFrames++;balance.sampleClock-=dt;balance.sampleElapsed+=dt;if(balance.sampleClock>0)return;
    const elapsed=Math.max(.1,balance.sampleElapsed),living=enemies.filter(enemy=>!enemy.dead),near=living.filter(enemy=>dist2(player,enemy)<=8**2).length,contact=living.filter(enemy=>dist2(player,enemy)<=3.2**2).length,ranged=living.filter(enemy=>enemy.type==='shooter').length,elite=living.filter(enemy=>enemy.elite||enemy.boss||enemy.miniboss).length,kills=s.kills||0,damageTaken=s.damageTaken||0,healing=s.healingDone||0,killsPerSecond=Math.max(0,kills-balance.lastKills)/elapsed,incomingDps=Math.max(0,damageTaken-balance.lastDamageTaken)/elapsed,healingPerSecond=Math.max(0,healing-balance.lastHealing)/elapsed,growth=enemyGrowth(),late=post15Scales(),spawnRate=growth.spawn*state.difficulty.spawn*late.spawn;
    balance.samples.push({time:Number(state.time.toFixed(2)),level:s.level,expectedLevel:Number(expectedPlayerLevel().toFixed(2)),levelDelta:Number((s.level-expectedPlayerLevel()).toFixed(2)),dps:Math.round(s.recentDpsTotal||s.lastDps||0),kills,killsPerSecond:Number(killsPerSecond.toFixed(3)),spawnRate:Number(spawnRate.toFixed(3)),killRatio:Number((killsPerSecond/Math.max(.1,spawnRate)).toFixed(3)),enemyCount:living.length,nearEnemies:near,contactEnemies:contact,nearRatio:Number((near/Math.max(1,living.length)).toFixed(3)),rangedEnemies:ranged,eliteEnemies:elite,incomingDps:Number(incomingDps.toFixed(3)),healingPerSecond:Number(healingPerSecond.toFixed(3)),hpRatio:Number((s.hp/Math.max(1,s.maxHp)).toFixed(3)),adaptiveHealth:Number((state.adaptive?.health||1).toFixed(4)),adaptiveDamage:Number((state.adaptive?.damage||1).toFixed(4)),adaptiveSpeed:Number((state.adaptive?.speed||1).toFixed(4)),adaptivePressure:Number((state.adaptive?.pressure||0).toFixed(4)),adaptiveDominant:Boolean(state.adaptive?.dominant),threatTier:state.threatTier,horde:state.hordeRemaining>0||state.hordeDuration>0,bosses:living.filter(enemy=>enemy.boss||enemy.miniboss).length,projectileLoad:projectiles.length+zones.length,stationaryShare:Number((balance.stationaryTime/Math.max(.1,balance.activeTime)).toFixed(3)),fps:Number((balance.fpsTotal/Math.max(1,balance.fpsFrames)).toFixed(1))});
    while(balance.samples.length>5000)balance.samples.shift();balance.lastKills=kills;balance.lastDamageTaken=damageTaken;balance.lastHealing=healing;balance.lastX=player.x;balance.lastZ=player.z;balance.sampleClock+=BALANCE_SAMPLE_INTERVAL;balance.sampleElapsed=0;balance.fpsTotal=0;balance.fpsFrames=0;
  }
  function pickEnemyType() {
    const t=runTimelineTime(),phase=lateGamePhase(),antiStatic=t>=360&&((player.stationaryTime||0)>=2.5||state.adaptive?.dominant),pool=[['grunt',phase===2?24:36],['runner',t>100?(phase===2?18:22):0],['brute',t>300?(phase===2?18:15):0],['swarm',t>480?(phase===2?10:14):0],['titan',t>720?(phase===2?10:7):0]];
    if(t>=600)pool.push(['charger',phase===2?16:8]);
    if(t>=660)pool.push(['shooter',phase===2?5.25:2.625]);
    if(t>=720)pool.push(['warden',phase===2?14:6]);
    if(t>=780)pool.push(['splitter',phase===2?16:7]);
    if(t>=360)pool.push(['burrower',(phase===2?12:6)*(antiStatic?1.6:1)]);
    if(t>=420)pool.push(['phaser',(phase===2?11:6)*(antiStatic?1.5:1)]);
    if(t>=450)pool.push(['standard',(phase===2?8:4)*(antiStatic?1.4:1)]);
    if(t>=480)pool.push(['absorber',(phase===2?8:4)*(antiStatic?1.35:1)]);
    let roll=gameRandom()*pool.reduce((sum,[,weight])=>sum+weight,0);
    for(const [type,weight] of pool){roll-=weight;if(roll<=0)return type;}
    return'grunt';
  }
  function spawnFocus(){const actors=liveActors();if(!actors.length)return player;return actors[Math.floor(gameRandom()*actors.length)].entity;}
  function closestActor(point){let best=null,bestD=Infinity;for(const actor of liveActors()){const d=dist2(point,actor.entity);if(d<bestD){bestD=d;best=actor;}}return best;}
  function spawnEnemy(type=pickEnemyType(),boss=false,allowElite=true) {
    const a=gameRandom()*TAU,d=type==='burrower'?rand(13,9):rand(35,26),base=ENEMY_TYPES[type];
    const late=post15Scales(),growth=enemyGrowth(),scaling=growth.health*late.health;
    const phase=lateGamePhase(),timeline=runTimelineTime(),adaptive=state.adaptive||{health:1,damage:1,speed:1,eliteBonus:0},lateElite=phase===2?.10+clamp((timeline-1200)/600,0,1)*.08:phase===1?.055:Math.min(.012,timeline/50000),eliteChance=Math.min(.4,(lateElite+(adaptive.eliteBonus||0))*(state.difficulty.elite??1));
    const elite=!boss&&allowElite&&(state.challenge==='elite'||gameRandom()<eliteChance),affix=elite?ELITE_AFFIXES[Math.floor(gameRandom()*ELITE_AFFIXES.length)]:null;
    const difficulty=state.difficulty;
    let hp=base.hp*scaling*(elite?3.5:1)*(boss?55*(difficulty.bossHealth??1):1)*difficulty.health*(adaptive.health||1),size=base.size*(elite?1.38:1)*(boss?2.45:1);
    if(affix?.id==='armored')hp*=1.35;if(elite&&(state.stats?.gildedLure||coopActors.some(actor=>actor.connected&&actor.stats?.gildedLure)))hp*=1.08;
    const focus=spawnFocus(),scalingPower=difficulty.scaling??1,e=acquirePooled('enemy');Object.assign(e,{nid:nextNetId++,spawnedAt:state.time,x:focus.x+Math.cos(a)*d,z:focus.z+Math.sin(a)*d,y:0,type,hp,maxHp:hp,speed:base.speed*(boss ? .936 : 1)*difficulty.speed*(1+state.threatTier*.008*scalingPower)*(affix?.id==='relentless'?1.15:1)*(adaptive.speed||1),damage:base.damage*growth.damage*(elite?1.45:1)*(boss?1.7:1)*difficulty.damage*late.damage*(adaptive.damage||1),size,xp:base.xp*(elite?6:1)*(boss?25:1),color:boss?COLORS.pink:base.color,elite,affix:affix?.id||'',affixName:affix?.name||'',affixColor:affix?.color||COLORS.white,boss,miniboss:false,dead:false,hit:0,orbitHit:0,slow:0,shieldHits:type==='warden'?(phase===2?3:2):0,rangedAttack:type==='shooter'?rand(3.8,2.4):0,chargeClock:type==='charger'?rand(5,2.8):0,chargeWindup:0,chargeTime:0,burrowWindup:type==='burrower'?1.25:0,absorbActive:type==='absorber',absorbClock:type==='absorber'?rand(4.2,3):0,bossAttack:boss?rand(7,4.8):0,bossShots:0,bossDashClock:boss?rand(10,8):0,bossDashWindup:0,bossDashTime:0,bossWaveClock:boss?rand(13,10):0,bossWaveWindup:0,bossSummonMask:0,bossPhaseInvuln:0,seed:gameRandom()*10});
    resolveObstacleOverlaps(e,Math.max(.3,e.size*.52));enemies.push(e);enemySpatialDirty=true;if(e.burrowWindup>0){e.burrowWarning={x:e.x,z:e.z,radius:2.15,life:e.burrowWindup,max:e.burrowWindup,color:COLORS.red,kind:'enemyWarning'};zones.push(e.burrowWarning);}return e;
  }
  function placeEnemy(e,x,z){e.x=x;e.z=z;enemySpatialDirty=true;resolveObstacleOverlaps(e,Math.max(.3,e.size*.52));if(e.burrowWarning){e.burrowWarning.x=e.x;e.burrowWarning.z=e.z;}return e;}
  function applySpawnThreatWeight(enemy){
    const bankWeight=Math.min(12,Math.floor(state.spawnThreatBank||0)),adaptiveWeight=Math.min(5,Math.round(state.adaptive?.threatWeight||0)),weight=Math.min(12,bankWeight+adaptiveWeight);if(weight<=0)return enemy;const consumedBank=Math.min(bankWeight,Math.max(0,weight-adaptiveWeight));state.spawnThreatBank=Math.max(0,(state.spawnThreatBank||0)-consumedBank);const health=1+weight*.12,damage=1+weight*.03,speed=1+consumedBank*.01;enemy.hp*=health;enemy.maxHp*=health;enemy.damage*=damage;enemy.speed*=speed;enemy.threatWeight=(enemy.threatWeight||0)+weight;return enemy;
  }
  function configureBoss(boss,kind){
    const info=BOSS_ARCHETYPES[kind]||BOSS_ARCHETYPES.breaker,base=ENEMY_TYPES[boss.type],lateHealthScale=lateBossHealthScale(),healthScale=290/base.hp*info.health*lateHealthScale,damageScale=24/base.damage;
    boss.hp*=healthScale;boss.maxHp=boss.hp;boss.damage*=damageScale;boss.speed*=info.speed;boss.size*=info.size;boss.color=info.color;boss.bossKind=kind;boss.bossName=info.name;boss.bossCanDash=info.canDash;boss.bossCanWave=info.canWave;boss.bossCanVolley=info.canVolley;boss.bossSpecialClock=rand(10,7);boss.bossLateHealthScale=lateHealthScale;boss.copiedWeapon='';return boss;
  }
  function spawnBoss(forcedKind='',healthMultiplier=1) {
    const order=state.bossOrder?.length?state.bossOrder:NET_BOSS_KINDS,kind=BOSS_ARCHETYPES[forcedKind]?forcedKind:order[state.bossOrderIndex++%order.length]||'breaker',info=BOSS_ARCHETYPES[kind];let first=null;
    for(let i=0;i<state.difficulty.bosses;i++){const b=configureBoss(spawnEnemy(info.type,true),kind);b.hp*=healthMultiplier;b.maxHp*=healthMultiplier;b.bossHealthMultiplier=healthMultiplier;state.balance?.events.push({type:'boss_spawn',time:Number(state.time.toFixed(2)),nid:b.nid,kind,name:info.name,copy:i+1,maxHp:Math.round(b.maxHp),lateHealthScale:Number((b.bossLateHealthScale||1).toFixed(3)),healthMultiplier});if(!first)first=b;}
    const count=state.difficulty.bosses;toast(`<b>${count>1?count+'× ':''}${info.name}</b> вошёл в реальность`,'#ff3f68');shake=1.2;audio.tone(kind==='worm'?52:kind==='architect'?105:70,.7,'sawtooth',.07);return first;
  }
  function spawnMiniBoss(stage) {
    const count=state.difficulty.bosses,type=stage===0?'warden':'titan';let first=null;
    for(let i=0;i<count;i++){
      const e=spawnEnemy(type,false,false),boost=stage===0?14:12;
      e.miniboss=true;e.elite=true;e.affix=stage===0?'armored':'relentless';e.affixName=stage===0?'БРОНИРОВАННЫЙ':'НЕУДЕРЖИМЫЙ';e.affixColor=stage===0?[.45,.72,1,1]:COLORS.amber;
      const lateHealthScale=lateBossHealthScale();e.hp*=boost*(state.difficulty.bossHealth??1)*lateHealthScale;e.maxHp=e.hp;e.damage*=1.55;e.speed*=1.06;e.size*=1.85;e.xp*=12;e.color=stage===0?[.18,.6,1,1]:[.92,.16,.68,1];e.shieldHits=stage===0?5:2;e.bossAttack=rand(6.8,4.8);e.bossDashClock=rand(12,9);e.bossDashWindup=0;e.bossDashTime=0;e.bossWaveClock=rand(15,12);e.bossWaveWindup=0;e.bossSummonMask=0;e.bossPhaseInvuln=0;e.bossLateHealthScale=lateHealthScale;
      const focus=spawnFocus(),a=gameRandom()*TAU,d=rand(27,22);placeEnemy(e,focus.x+Math.cos(a)*d,focus.z+Math.sin(a)*d);state.balance?.events.push({type:'miniboss_spawn',time:Number(state.time.toFixed(2)),nid:e.nid,stage:stage+1,copy:i+1,maxHp:Math.round(e.maxHp),lateHealthScale:Number(lateHealthScale.toFixed(3))});if(!first)first=e;
    }
    shake=1.35;audio.tone(stage===0?78:62,.8,'sawtooth',.075);return first;
  }
  function fireBossVolley(boss) {
    if(boss.dead)return;const count=boss.miniboss?3:state.threatTier>=10?5:3,aim=Math.atan2(player.z-boss.z,player.x-boss.x),speed=6.5+state.threatTier*.08;
    boss.bossShots++;
    beams.push({x1:boss.x,z1:boss.z,x2:player.x,z2:player.z,life:.22,max:.22,color:COLORS.red});
    for(let i=0;i<count;i++){
      const a=aim+(i-(count-1)/2)*.2;
      spawnEnemyProjectile({x:boss.x,z:boss.z,y:1.1+boss.size*.35,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,life:5.5,damage:boss.damage*.42,bossDamage:true,size:.34,color:i===(count-1)/2?COLORS.pink:COLORS.red,spin:Math.random()*TAU});
    }
    burst(boss.x,boss.z,COLORS.red,7,.6);audio.tone(145,.16,'sawtooth',.025);
  }
  function fireBossRadial(boss,count=12,damage=.34) {
    if(boss.dead)return;const speed=6.2+state.threatTier*.07;
    for(let i=0;i<count;i++){const a=i/count*TAU+boss.seed;spawnEnemyProjectile({x:boss.x,z:boss.z,y:1+boss.size*.3,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,life:5,damage:boss.damage*damage,bossDamage:true,size:.29,color:COLORS.red,spin:nativeRandom()*TAU});}
    burst(boss.x,boss.z,COLORS.red,12,.9);audio.tone(92,.22,'sawtooth',.035);
  }
  function spawnArchitectTraps(boss,target) {
    const count=state.threatTier>=12?5:4;
    for(let i=0;i<count;i++){const a=i/count*TAU+boss.seed,d=i===0?0:rand(4.6,2.1);zones.push({x:target.entity.x+Math.cos(a)*d,z:target.entity.z+Math.sin(a)*d,radius:1.75,life:1.05,max:1.05,color:COLORS.red,kind:'enemyTrap',damage:boss.damage*.72,source:boss.nid});}
    toast('<b>АРХИТЕКТОР</b> · ловушки разлома','#ff3f68');audio.tone(170,.24,'square',.025);
  }
  function summonSwarmPulse(boss) {
    const count=state.threatTier>=12?12:9;
    for(let i=0;i<count;i++){const minion=spawnEnemy(i%4===0?'runner':'swarm',false,false),a=i/count*TAU+boss.seed,d=rand(5.8,3.2);placeEnemy(minion,boss.x+Math.cos(a)*d,boss.z+Math.sin(a)*d);minion.speed*=1.18;minion.damage*=1.12;}
    burst(boss.x,boss.z,boss.color,18,1.1);audio.tone(125,.32,'sawtooth',.035);
  }
  function fireMirrorAttack(boss,target) {
    const ranked=Object.entries(target.weapons||{}).filter(([,level])=>level>0).sort((a,b)=>b[1]-a[1]),weapon=ranked[0]?.[0]||'blaster';boss.copiedWeapon=weapon;
    if(['aura','orbit','frost','gravity','firetrail'].includes(weapon)){const count=weapon==='firetrail'?5:3;for(let i=0;i<count;i++){const a=i/count*TAU+boss.seed,d=i?rand(4.5,2.3):0;zones.push({x:target.entity.x+Math.cos(a)*d,z:target.entity.z+Math.sin(a)*d,radius:weapon==='gravity'?2.4:1.8,life:1.15,max:1.15,color:COLORS.red,kind:'enemyTrap',damage:boss.damage*(weapon==='gravity'?.8:.62),source:boss.nid});}}
    else fireBossRadial(boss,weapon==='lightning'?16:weapon==='meteor'?10:12,weapon==='saw'?.42:.34);
    toast(`<b>ЗЕРКАЛО</b> · скопировано: ${WEAPON_INFO[weapon]?.name||weapon}`,'#b96cff');
  }
  function updateBossSpecial(boss,target,dt) {
    if(!boss.boss||!boss.bossKind||boss.burrowWindup>0)return false;boss.bossSpecialClock=(boss.bossSpecialClock||8)-dt*bossActionTempo();if(boss.bossSpecialClock>0)return false;
    if(boss.bossKind==='worm'){
      const a=gameRandom()*TAU,d=rand(5.8,3.5);placeEnemy(boss,target.entity.x+Math.cos(a)*d,target.entity.z+Math.sin(a)*d);boss.burrowWindup=1.2;boss.bossBurrowAttack=true;boss.burrowWarning={x:boss.x,z:boss.z,radius:2.6,life:1.2,max:1.2,color:COLORS.red,kind:'enemyWarning'};zones.push(boss.burrowWarning);boss.bossSpecialClock=rand(8.5,6.8);return true;
    }
    if(boss.bossKind==='architect')spawnArchitectTraps(boss,target);
    else if(boss.bossKind==='swarmking')summonSwarmPulse(boss);
    else if(boss.bossKind==='mirror')fireMirrorAttack(boss,target);
    boss.bossSpecialClock=boss.bossKind==='swarmking'?rand(9.5,7.5):rand(10.5,8);return false;
  }
  function fireEnemyShot(e) {
    const aim=Math.atan2(player.z-e.z,player.x-e.x),count=lateGamePhase()===2?2:1,speed=7.2+state.threatTier*.06;
    for(let i=0;i<count;i++){
      const a=aim+(i-(count-1)/2)*.16;
      spawnEnemyProjectile({x:e.x+Math.cos(a)*(e.size+.25),z:e.z+Math.sin(a)*(e.size+.25),y:.85+e.size*.4,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,life:5,damage:e.damage*.58,size:.25,color:COLORS.red,spin:Math.random()*TAU});
    }
    beams.push({x1:e.x,z1:e.z,x2:player.x,z2:player.z,life:.12,max:.12,color:COLORS.red});
  }
  function summonBossReinforcements(boss,phase) {
    const swarm=boss.bossKind==='swarmking',lateExtra=Math.floor(clamp((runTimelineTime()-600)/900,0,1)*4),count=(phase===1?6:8)+(swarm?6:0)+lateExtra,types=swarm?['swarm','swarm','runner','splitter']:boss.bossKind==='architect'?['warden','absorber','shooter']:runTimelineTime()>=480?['runner','charger','phaser','burrower','warden']:['runner','brute','charger'];
    for(let i=0;i<count;i++){
      const minion=spawnEnemy(types[i%types.length],false,false),affix=ELITE_AFFIXES[(i+phase)%ELITE_AFFIXES.length],a=i/count*TAU+boss.seed,d=rand(7,4);
      placeEnemy(minion,boss.x+Math.cos(a)*d,boss.z+Math.sin(a)*d);minion.elite=true;minion.affix=affix.id;minion.affixName=affix.name;minion.affixColor=affix.color;minion.hp*=2.2;minion.maxHp=minion.hp;minion.damage*=1.25;minion.size*=1.12;minion.xp*=4;
    }
    burst(boss.x,boss.z,COLORS.red,22,1.25);toast(`<b>ФАЗА БОССА ${phase}</b> · элитная свита вошла в бой`,'#ff3f68');shake=1.05;audio.tone(72,.55,'sawtooth',.055);
  }
  function triggerBossPhase(boss,phase){
    const bit=phase===1?1:2;if(boss.dead||(boss.bossSummonMask&bit))return false;boss.bossSummonMask|=bit;boss.bossPhaseInvuln=rand(1,.7);summonBossReinforcements(boss,phase);return true;
  }
  function fireBossShockwave(boss) {
    const radius=7.2;zones.push({x:boss.x,z:boss.z,radius,life:.36,max:.36,color:COLORS.red,kind:'enemyBlast'});
    for(const actor of liveActors()){
      const dx=actor.entity.x-boss.x,dz=actor.entity.z-boss.z,d=Math.hypot(dx,dz)||1;if(d>radius)continue;
      withActor(actor,()=>hurtPlayer(boss.damage*.62,boss));moveWithObstacles(actor.entity,dx/d*3.4,dz/d*3.4,.52);
    }
    burst(boss.x,boss.z,COLORS.red,28,1.45);shake=1.25;audio.tone(58,.42,'sawtooth',.07);
  }
  function applyDifficulty(mults) {
    const d=state.difficulty;
    for(const key of ['spawn','health','damage','speed','reward'])if(mults[key])d[key]*=mults[key];
    for(const e of enemies){
      if(e.dead)continue;
      if(mults.health){e.hp*=mults.health;e.maxHp*=mults.health;}
      if(mults.damage)e.damage*=mults.damage;
      if(mults.speed)e.speed*=mults.speed;
    }
    shake=.9;updateUI(true);
  }
  function burst(x,z,color,count=5,power=1) {
    const visualRand=(a=1,b=0)=>b+nativeRandom()*(a-b);for(let i=0;i<count;i++){const a=nativeRandom()*TAU,s=visualRand(5,1.5)*power,p=acquirePooled('particle');p.x=x;p.z=z;p.y=visualRand(1.3,.2);p.vx=Math.cos(a)*s;p.vz=Math.sin(a)*s;p.vy=visualRand(5,1);p.life=visualRand(.65,.25);p.max=.65;p.size=visualRand(.25,.08)*power;p.color=color;particles.push(p);}
  }
  const compactCombatNumber=new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1});
  function acquireCombatTextNode(){let node=combatTextNodePool.pop();if(!node){node=document.createElement('span');node.append(document.createElement('b'),document.createElement('small'));}return node;}
  function releaseCombatTextEntry(entry){const node=entry?.node;if(!node)return;node.remove();node.className='combat-text';node.removeAttribute('style');if(combatTextNodePool.length<32)combatTextNodePool.push(node);}
  function clearCombatTexts(){for(const entry of combatTexts)releaseCombatTextEntry(entry);combatTexts.length=0;combatTextBuckets.clear();}
  function combatTextLabel(type,amount,critical=false){const value=compactCombatNumber.format(Math.max(0,Math.round(amount)));if(type==='heal')return`+${value}`;if(type==='incoming')return`−${value}`;if(type==='blocked')return`◆ ${value}`;return critical?`✦ ${value}`:value;}
  function spawnCombatText(bucket){
    if(!combatTextLayer||state.mode==='menu')return;const priority=bucket.priority||1,maxVisible=28;
    if(combatTexts.length>=maxVisible){let weakest=0;for(let i=1;i<combatTexts.length;i++)if(combatTexts[i].priority<combatTexts[weakest].priority||combatTexts[i].priority===combatTexts[weakest].priority&&combatTexts[i].age>combatTexts[weakest].age)weakest=i;if(combatTexts[weakest].priority>priority)return;releaseCombatTextEntry(combatTexts[weakest]);combatTexts.splice(weakest,1);}
    const node=acquireCombatTextNode(),value=node.children[0],detail=node.children[1];node.className=`combat-text ${bucket.type}${bucket.critical?' critical':''}`;value.textContent=combatTextLabel(bucket.type,bucket.amount,bucket.critical);if(bucket.hits>1||bucket.type==='blocked'){detail.textContent=bucket.type==='blocked'?'БЛОК':`×${bucket.hits}`;detail.style.display='';}else{detail.textContent='';detail.style.display='none';}combatTextLayer.append(node);
    combatTexts.push({node,x:bucket.x,z:bucket.z,y:bucket.y,type:bucket.type,critical:bucket.critical,priority,age:0,life:bucket.critical?1.05:bucket.type==='incoming'?.92:.78,drift:(nativeRandom()-.5)*18});
  }
  function queueCombatText(type,x,z,y,amount,key,critical=false,priority=1){
    if(!Number.isFinite(amount)||amount<.05||state.mode==='menu')return;const bucketKey=`${type}:${key}`,existing=combatTextBuckets.get(bucketKey);
    if(existing){existing.amount+=amount;existing.hits++;existing.x=lerp(existing.x,x,.3);existing.z=lerp(existing.z,z,.3);existing.y=Math.max(existing.y,y);existing.critical=existing.critical||critical;existing.priority=Math.max(existing.priority,priority);return;}
    if(combatTextBuckets.size>=80)combatTextBuckets.delete(combatTextBuckets.keys().next().value);
    combatTextBuckets.set(bucketKey,{type,x,z,y,amount,hits:1,critical,priority,delay:type==='heal'?.24:critical?.075:.14});
  }
  function queueEnemyDamageText(enemy,amount,critical){
    if(!enemy||dist2(enemy,player)>30**2)return;const important=critical||enemy.boss||enemy.miniboss,key=important?enemy.nid:`${Math.round(enemy.x/2.6)}:${Math.round(enemy.z/2.6)}`;queueCombatText('damage',enemy.x,enemy.z,Math.max(.9,enemy.size*2.05),amount,key,critical,critical?4:enemy.boss||enemy.miniboss?3:1);
  }
  function updateCombatTexts(dt){for(const [key,bucket] of combatTextBuckets){bucket.delay-=dt;if(bucket.delay<=0){combatTextBuckets.delete(key);spawnCombatText(bucket);}}for(let i=combatTexts.length-1;i>=0;i--){const entry=combatTexts[i];entry.age+=dt;if(entry.age>=entry.life){releaseCombatTextEntry(entry);combatTexts.splice(i,1);}}}
  function renderCombatTexts(){
    if(!combatTextLayer)return;for(const entry of combatTexts){const point=projectTargetPoint(entry.x,entry.y,entry.z);if(!point){entry.node.style.opacity='0';continue;}const progress=clamp(entry.age/entry.life,0,1),fadeIn=clamp(progress/.12,0,1),fadeOut=1-clamp((progress-.68)/.32,0,1),scale=(entry.critical?1.2:1)*(1+(1-progress)*(entry.critical?.24:.08));entry.node.style.left=`${point.x}px`;entry.node.style.top=`${point.y}px`;entry.node.style.opacity=String(fadeIn*fadeOut);entry.node.style.transform=`translate(-50%,-50%) translate(${entry.drift*progress}px,${-44*progress}px) scale(${scale})`;entry.node.style.zIndex=String(Math.round(1000-point.depth*100));}
  }
  function healPlayer(amount){const s=state.stats,before=s.hp;s.hp=Math.min(s.maxHp,s.hp+Math.max(0,amount));const healed=Math.max(0,s.hp-before);s.healingDone=(s.healingDone||0)+healed;if(healed>.05)queueCombatText('heal',player.x,player.z,1.95,healed,activeActorId||'player',false,2);return healed;}
  function gainXP(amount) {
    const s=state.stats;s.xp+=amount*s.xpMult;
    while(s.xp>=s.xpNeed){s.xp-=s.xpNeed;s.level++;s.xpNeed=xpNeedForLevel(s.level);pendingLevels++;s.forgeWeapons=[];if(s.pocketForge&&s.level%5===0){const pool=Object.keys(state.weapons).filter(id=>state.weapons[id]>0);for(let i=pool.length-1;i>0;i--){const j=Math.floor(gameRandom()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}s.forgeWeapons=pool.slice(0,Math.min(s.pocketForge,pool.length));if(s.forgeWeapons.length)toast(`<b>КАРМАННАЯ КУЗНИЦА</b> · ${s.forgeWeapons.map(id=>WEAPON_INFO[id].name).join(', ')} +1 уровень`,'#ffbd3d');}if(s.levelPower&&s.level%5===0)s.levelPowerBonus=(s.levelPowerBonus||0)+s.baseDamage*s.levelPower*.02;if(state.hero==='gambler'&&s.level%8===0&&s.gamblerMilestone<12)applyGamblerMilestone();if(s.levelHeal)healPlayer(s.maxHp*.03*s.levelHeal);}
    if(pendingLevels>0&&state.mode==='playing'){if(isCoopHost())requestChoice('level');else openChoice('level');}
  }
  function applyGamblerMilestone(){
    const s=state.stats,blessings=[()=>{s.damageMult+=s.baseDamage*.12;return'+12% базового урона'},()=>{s.fireRate*=1.1;return'+10% темпа атак'},()=>{s.crit+=.08;return'+8% критического шанса'},()=>{s.projectiles++;return'+1 снаряд'}],curses=[()=>{if(!state.hardcore){s.maxHp=Math.max(20,s.maxHp*.94);s.hp=Math.min(s.hp,s.maxHp);}return'−6% максимального HP'},()=>{s.armor=Math.max(-20,s.armor-6);return'−6 брони'},()=>{s.speed*=.95;return'−5% скорости'},()=>{s.pickup*=.85;return'−15% радиуса сбора'}],blessing=blessings[Math.floor(gameRandom()*blessings.length)](),curse=curses[Math.floor(gameRandom()*curses.length)]();s.gamblerMilestone=(s.gamblerMilestone||0)+1;toast(`<b>БРОСОК АЗАРТНИКА</b> · ${blessing}<br><small>${curse}</small>`,'#ffbd3d');
  }
  function dropGem(e) {
    let value=e.xp*ENEMY_XP_RATE*state.difficulty.reward*(state.xpPace||1);if(gameRandom()<.035)value*=5;
    const gem=acquirePooled('gem');gem.x=e.x;gem.z=e.z;gem.y=.35;gem.value=value;gem.vx=rand(2,-2);gem.vz=rand(2,-2);gem.color=value>=5?COLORS.amber:COLORS.cyan;gem.life=60;gems.push(gem);
  }
  function dropConsumable(e) {
    const s=state.stats,baseChance=Math.min(CONSUMABLE_CHANCE_CAP,CONSUMABLE_BASE_CHANCE*(1+s.dropLuck));
    const chance=e.boss||e.miniboss?CONSUMABLE_CHANCE_CAP:Math.min(CONSUMABLE_CHANCE_CAP,baseChance*(e.elite?1.5:1));
    if(gameRandom()>chance)return;
    const roll=gameRandom();let type=roll<.32?'magnet':roll<.55?'speed':roll<.75?'double':roll<.88?'heal':'immortal';
    const consumable=acquirePooled('consumable');consumable.x=e.x+rand(.8,-.8);consumable.z=e.z+rand(.8,-.8);consumable.y=.55;consumable.type=type;consumable.life=28;consumable.seed=Math.random()*TAU;consumables.push(consumable);
  }
  function activateConsumable(type) {
    const c=CONSUMABLES[type],s=state.stats;
    if(type==='heal')healPlayer(s.maxHp*.35);
    else state.buffs[type]=Math.max(state.buffs[type]||0,timedBuffDuration(c.duration));
    if(type==='magnet')for(const g of gems){g.life=Math.max(g.life,5);}
    toast(`<b>${c.name}</b> — ${c.desc}`,c.color);burst(player.x,player.z,type==='double'?COLORS.violet:type==='immortal'?COLORS.amber:COLORS.cyan,16,1.2);audio.tone(type==='immortal'?820:610,.2,'triangle',.045);
  }
  function killProcCoefficient(source){if(NON_RECURSIVE_SOURCES.has(source))return 0;if(['firetrail','storm','voidPressure','mines','mortar','seismic'].includes(source))return .35;return 1;}
  function killEnemy(e,source='unknown') {
    if(e.dead)return;const wasLocked=player.lockedTargetNid===e.nid;e.dead=true;clearTargetLocksForEnemy(e);const s=state.stats,procCoefficient=killProcCoefficient(source);s.kills++;s.killsBySource=s.killsBySource||{};s.killsBySource[source]=(s.killsBySource[source]||0)+1;dropGem(e);dropConsumable(e);burst(e.x,e.z,e.boss||e.miniboss?COLORS.amber:e.elite?COLORS.violet:COLORS.white,e.boss||e.miniboss?32:e.elite?16:5,e.boss||e.miniboss?2:1);
    if((e.boss||e.miniboss)&&state.balance)state.balance.events.push({type:e.boss?'boss_kill':'miniboss_kill',time:Number(state.time.toFixed(2)),nid:e.nid,kind:e.bossKind||e.type,name:e.bossName||e.type,ttk:Number(Math.max(0,state.time-(e.spawnedAt??state.time)).toFixed(2)),source});
    if(state.hero==='duelist'&&wasLocked){state.buffs.duelist=Math.max(state.buffs.duelist,5);toast('<b>ДУЭЛЬ ЗАВЕРШЕНА</b> · скорость и критический шанс усилены','#dcefff');}
    if(state.hero==='necromancer'&&s.kills%35===0){heroUnits.push({kind:'minion',owner:activeActorId,x:e.x,z:e.z,life:30,max:30,attackClock:.2,seed:gameRandom()*TAU});s.heroActivations=(s.heroActivations||0)+1;while(heroUnits.filter(unit=>unit.kind==='minion'&&unit.owner===activeActorId).length>8)heroUnits.splice(heroUnits.findIndex(unit=>unit.kind==='minion'&&unit.owner===activeActorId),1);burst(e.x,e.z,COLORS.violet,9,.65);}
    if(state.hero==='pyromancer'&&e.burnTime>0&&source!=='pyroblast'&&gameRandom()<.30){const radius=3;zones.push({owner:activeActorId,x:e.x,z:e.z,radius,life:.38,max:.38,color:COLORS.amber,kind:'pulse'});for(const other of enemyCandidates(e.x,e.z,radius))if(!other.dead&&dist2(e,other)<radius*radius)damageEnemy(other,18+(s.level*.25),'pyroblast',false);}
    if(state.hero==='voidwalker'&&zones.some(zone=>zone.owner===activeActorId&&zone.kind==='gravity'&&dist2(zone,e)<zone.radius*zone.radius))state.cooldowns.gravity=Math.max(0,state.cooldowns.gravity-.32);
    if(e.type==='splitter'&&!e.summoned){const count=e.elite?5:3;for(let i=0;i<count;i++){const child=spawnEnemy('swarm',false,false),a=i/count*TAU+gameRandom()*.35;child.x=e.x+Math.cos(a)*(e.size+.4);child.z=e.z+Math.sin(a)*(e.size+.4);child.summoned=true;child.xp=.5;}burst(e.x,e.z,COLORS.violet,10,.8);}
    if(e.affix==='volatile'&&!e.miniboss){const count=8;for(let i=0;i<count;i++){const a=i/count*TAU,offset=e.size+.45;spawnEnemyProjectile({x:e.x+Math.cos(a)*offset,z:e.z+Math.sin(a)*offset,y:.55,vx:Math.cos(a)*6.4,vz:Math.sin(a)*6.4,life:3.5,damage:e.damage*.38,size:.23,color:COLORS.red,spin:Math.random()*TAU});}burst(e.x,e.z,COLORS.red,18,1.25);}
    if(s.feedback&&procCoefficient>0){const limit=.3+s.feedback*.12,available=Math.max(0,limit-(s.feedbackCutUsed||0)),cut=Math.min(.012*s.feedback*procCoefficient,available);if(cut>0){s.feedbackCutUsed=(s.feedbackCutUsed||0)+cut;for(const k in state.cooldowns)state.cooldowns[k]=Math.max(0,state.cooldowns[k]-cut);}}
    if(s.blood&&s.kills%200===0){healPlayer(4*s.blood);s.bloodBonus=Math.min(s.baseDamage*2,s.bloodBonus+s.baseDamage*.02*s.blood);toast(`<b>КРОВАВАЯ БАТАРЕЯ</b> · базовый урон +${Math.round(s.bloodBonus/s.baseDamage*100)}%`,'#ff3f68');}
    if(s.thermoSiphon&&e.burnTime>0&&s.thermoHealClock<=0){healPlayer(s.maxHp*.008*s.thermoSiphon);s.thermoHealClock=1;}
    if(s.soulCollector&&e.elite&&!e.boss&&!e.miniboss)s.soulCharges=Math.min(30,(s.soulCharges||0)+s.soulCollector);
    const special=e.elite||e.miniboss||e.boss||!['grunt','runner','brute','swarm'].includes(e.type);if(s.cleanupProtocol&&special){s.cleanupStacks=Math.min(5,(s.cleanupStacks||0)+1);s.cleanupTimer=4;}
    if(source==='nanoswarm'&&hasEvolution('nanoswarm')&&projectiles.filter(p=>p.owner===activeActorId&&p.kind==='nanite').length<20&&gameRandom()<.35)spawnNanite(e.x,e.z,activeActorId,6+weaponLevel('nanoswarm')*2.2,3+Math.floor(weaponLevel('nanoswarm')/4),true);
    const novaThreshold=Math.max(12,30-s.killNova*3);if(s.killNova)s.killNovaProgress=(s.killNovaProgress||0)+procCoefficient;
    if(s.killNova&&s.killNovaProgress>=novaThreshold){s.killNovaProgress-=novaThreshold;
      const radius=areaRadius(4+s.killNova*.7);zones.push({owner:activeActorId,x:player.x,z:player.z,radius,life:.38,max:.38,color:COLORS.green,kind:'pulse'});
      for(const other of enemyCandidates(player.x,player.z,radius))if(!other.dead&&dist2(player,other)<radius*radius)damageEnemy(other,18+s.killNova*11,'killnova',false);
    }
    if(s.corpseFire&&procCoefficient>0&&gameRandom()<Math.min(.7,s.corpseFire*.10*procCoefficient)){
      const duration=zoneDuration(1.8+s.corpseFire*.25);zones.push({owner:activeActorId,x:e.x,z:e.z,radius:areaRadius(1.15+s.corpseFire*.08),life:duration,max:duration,color:COLORS.cyan,kind:'firetrail',weapon:'corpseFire',damage:(5+s.corpseFire*2.5)*(1+s.burnPower*.20),tick:0});
    }
    if(e.elite&&!e.boss&&!e.miniboss&&gameRandom()<.6){const gem=acquirePooled('gem');gem.x=e.x;gem.z=e.z;gem.y=.4;gem.value=15;gem.vx=0;gem.vz=0;gem.color=COLORS.violet;gem.life=60;gems.push(gem);}
    if(e.boss||e.miniboss){
      s.soulCharges=0;
      if(isCoopHost()){for(const actor of liveActors()){withActor(actor,()=>healPlayer(state.stats.maxHp*.35));actor.pendingChests++;setTimeout(()=>{if(state.mode==='playing'&&!actor.choice)withActor(actor,()=>openCompactChoice('boss'))},260);}}
      else{healPlayer(s.maxHp*.35);pendingChests++;setTimeout(()=>{if(state.mode==='playing')openChoice('boss')},260);}
    }
  }
  function damageEnemy(e,amount,source='normal',canCrit=true,preScaled=false) {
    const bossLike=e.boss||e.miniboss;if(e.dead||e.burrowWindup>0||bossLike&&e.bossPhaseInvuln>0)return 0;const s=state.stats,fireSource=['firetrail','corpseFire','pyroblast'].includes(source);let crit=canCrit&&gameRandom()<s.crit+(state.buffs.duelist>0?.25:0);
    const missing=1-s.hp/s.maxHp,crowd=enemies.length>100?1+s.crowdPower*.10:1,bossMult=bossLike?1+s.bossSlayer*.15:1;
    let dmg=preScaled?amount:amount*(s.damageMult+s.bloodBonus+(s.levelPowerBonus||0))*(1+missing*s.desperation*.12)*crowd*bossMult*doubleBuffMultiplier();if(!preScaled&&PROJECTILE_DAMAGE_SOURCES.has(source))dmg*=s.projectileDamage||1;const weaponFamily=DAMAGE_SOURCE_WEAPON[source];if(weaponFamily)dmg*=1+(s.riftWeaponPower?.[weaponFamily]||0);
    if(!preScaled){if(state.hero==='berserker')dmg*=1+Math.floor(missing*10)*.06;if(state.hero==='duelist')dmg*=player.lockedTargetNid===e.nid?1.35:.9;if(state.hero==='pyromancer'){if(fireSource){e.pyroBurnStacks=Math.min(5,(e.pyroBurnStacks||0)+1);e.burnTime=Math.max(e.burnTime||0,1.1);dmg*=1+(e.pyroBurnStacks-1)*.12;}else dmg*=.8;}if(state.hero==='voidwalker'&&zones.some(zone=>zone.owner===activeActorId&&zone.kind==='gravity'&&dist2(zone,e)<zone.radius*zone.radius))dmg*=1.25;if(riftwalkerActive())dmg*=1.18;}
    if(!preScaled){if(anchorActive())dmg*=1+s.hunterAnchor*.08;if(s.bloodContract&&s.hp>=s.maxHp-.01)dmg*=1.1;if(AREA_DAMAGE_SOURCES.has(source)&&s.blackPowder)dmg*=1+s.blackPowder*.15;if(e.slow>0&&s.cryoCapillary)dmg*=1+s.cryoCapillary*.04*(bossLike?.5:1);if(e.burnTime>0&&s.thermoSiphon&&!['firetrail','corpseFire'].includes(source))dmg*=1+s.thermoSiphon*.05;if(bossLike&&s.soulCharges)dmg*=1+s.soulCharges*.005;
      if(s.pursuitMark&&!NON_RECURSIVE_SOURCES.has(source)){if(s.pursuitTarget!==e.nid){s.pursuitTarget=e.nid;s.pursuitTime=0;}dmg*=1+Math.min(.2,(s.pursuitTime||0)*.04*s.pursuitMark);}}
    if(riftwalkerActive()&&canCrit)crit=true;if(crit)dmg*=s.critMult;
    if(s.execute&&!bossLike&&e.hp/e.maxHp<=s.execute)dmg=e.hp+1;
    if(e.type==='phaser'){const target=closestActor(e);if(target&&dist2(e,target.entity)>5.5**2)dmg*=.22;}
    if(!bossLike&&e.type!=='standard'&&activeStandards.some(standard=>!standard.dead&&dist2(e,standard)<8.2**2))dmg*=.72;
    if(e.affix==='armored')dmg*=.62;
    if(e.shieldHits>0&&dmg>e.maxHp*.08){e.shieldHits--;dmg=Math.min(dmg,e.maxHp*.08);burst(e.x,e.z,[.45,.72,1,1],7,.65);}if(bossLike){const softCap=e.maxHp*(e.boss?BOSS_DAMAGE_SOFT_CAP:MINIBOSS_DAMAGE_SOFT_CAP);dmg=softCap*(1-Math.exp(-dmg/Math.max(1,softCap)));}
    let phase=0;if(bossLike){const first=e.maxHp*.7,second=e.maxHp*.35;if(!(e.bossSummonMask&1)&&e.hp>first&&e.hp-dmg<=first){dmg=Math.min(dmg,e.hp-first);phase=1;}else if(e.bossSummonMask&1&&!(e.bossSummonMask&2)&&e.hp>second&&e.hp-dmg<=second){dmg=Math.min(dmg,e.hp-second);phase=2;}}
    const dealt=Math.min(dmg,Math.max(0,e.hp));e.hp-=dealt;e.hit=.09;s.damageDone+=dealt;s.damageBySource=s.damageBySource||{};s.damageBySource[source]=(s.damageBySource[source]||0)+dealt;if(TELEMETRY_ENABLED){s.overkillPrevented=(s.overkillPrevented||0)+Math.max(0,dmg-dealt);s.recentDamage=s.recentDamage||{};s.recentDamage[source]=(s.recentDamage[source]||0)+dealt;s.dpsWindow=(s.dpsWindow||0)+dealt;}if(crit)s.criticalHits=(s.criticalHits||0)+1;queueEnemyDamageText(e,dealt,crit);if(phase)triggerBossPhase(e,phase);
    if(crit&&s.critExplosion&&source!=='critburst'){
      burst(e.x,e.z,COLORS.amber,4,.7);const radius=areaRadius(2+s.critExplosion*.35),share=.07+.03*s.critExplosion;
      for(const other of enemyCandidates(e.x,e.z,radius))if(other!==e&&!other.dead&&dist2(e,other)<radius*radius)damageEnemy(other,dealt*share,'critburst',false,true);
    }
    if(dealt>0&&s.dischargeCap&&!NON_RECURSIVE_SOURCES.has(source)){s.dischargeHits=(s.dischargeHits||0)+1;const threshold=Math.max(15,27-s.dischargeCap*2);if(s.dischargeHits>=threshold){s.dischargeHits-=threshold;let from=e;for(const other of nearestEnemies(e.x,e.z,7,3,[e])){damageEnemy(other,dealt*.28,'discharge',false,true);beams.push({x1:from.x,z1:from.z,x2:other.x,z2:other.z,life:.12,max:.12,color:COLORS.cyan,kind:'lightning'});from=other;}}}
    if(dealt>0&&s.unstableDuplicator&&!NON_RECURSIVE_SOURCES.has(source)&&gameRandom()<Math.min(.4,s.unstableDuplicator*.04)&&e.hp>0)damageEnemy(e,dealt*.60,'unstableDuplicate',false,true);
    if(s.lifesteal){const cap=s.maxHp*clamp(.035+s.lifesteal*8,.035,.14),available=Math.max(0,cap-(s.lifestealWindow||0)),healed=healPlayer(Math.min(dealt*s.lifesteal,available));s.lifestealWindow=(s.lifestealWindow||0)+healed;}if(state.hero==='berserker'&&missing>=.5)healPlayer(Math.min(.65,dealt*.0015));
    if(e.hp<=0)killEnemy(e,source);return dealt;
  }
  function hurtPlayer(raw,e,bossDamage=false) {
    if(actorById(activeActorId)?.debugGod||state.invuln>0||state.buffs.immortal>0||state.mode!=='playing')return;const s=state.stats;
    if(s.shield>0){s.shield--;s.shieldClock=8;s.damageBlocked=(s.damageBlocked||0)+raw;queueCombatText('blocked',player.x,player.z,2.05,raw,activeActorId||'player',false,4);state.invuln=.35;toast(`<b>ЩИТ ПОГЛОТИЛ УДАР</b> · зарядов ${s.shield}/${s.shieldMax}`,'#38f3ff');burst(player.x,player.z,COLORS.cyan,8,.7);if(state.hero==='guardian'&&s.shield===0){const radius=5.2;zones.push({owner:activeActorId,x:player.x,z:player.z,radius,life:.48,max:.48,color:COLORS.cyan,kind:'pulse'});for(const enemy of enemyCandidates(player.x,player.z,radius))if(!enemy.dead&&dist2(player,enemy)<radius*radius)damageEnemy(enemy,22+s.level*.3,'guardianNova',false);toast('<b>КОНТРВОЛНА СТРАЖА</b> · щит разрушен','#38f3ff');}return;}
    if(state.hero==='berserker')raw*=1.15;
    const mitigated=raw*100/(100+s.armor),bossHit=bossDamage||Boolean(e&&(e.boss||e.miniboss));
    const damage=!state.hardcore&&bossHit?Math.min(mitigated,s.maxHp*BOSS_SINGLE_HIT_CAP):mitigated;
    const armorBlocked=Math.max(0,raw-damage);s.hp-=damage;s.damageTaken+=damage;s.damageBlocked=(s.damageBlocked||0)+armorBlocked;queueCombatText('incoming',player.x,player.z,2.08,damage,activeActorId||'player',false,5);if(armorBlocked>=Math.max(1,raw*.15))queueCombatText('blocked',player.x,player.z,1.72,armorBlocked,`${activeActorId||'player'}:armor`,false,3);s.resonanceStacks=Math.floor((s.resonanceStacks||0)/2);state.invuln=.45;shake=Math.min(1.1,shake+.5);$('#damageFlash').style.opacity='.75';setTimeout(()=>$('#damageFlash').style.opacity='0',80);audio.tone(115,.09,'sawtooth',.045);
    if(s.emergencyTeleport&&s.hp>0&&s.hp<=s.maxHp*.2&&s.teleportCooldown<=0){const away=e?Math.atan2(player.z-e.z,player.x-e.x):gameRandom()*TAU,distance=5.5+s.emergencyTeleport*.7;burst(player.x,player.z,COLORS.violet,10,.8);player.x+=Math.cos(away)*distance;player.z+=Math.sin(away)*distance;resolveObstacleOverlaps(player,.52);s.teleportCooldown=Math.max(25,45-(s.emergencyTeleport-1)*5);state.invuln=Math.max(state.invuln,.8);burst(player.x,player.z,COLORS.cyan,10,.8);toast('<b>АВАРИЙНЫЙ ТЕЛЕПОРТ</b> · критическая угроза','#38f3ff');}
    if(s.thorns&&e)damageEnemy(e,s.thorns,'thorns',false);
    if(s.hp<=0&&s.revives>0){s.revives--;s.hp=0;healPlayer(s.maxHp*.6);state.buffs.immortal=4;toast('<b>ЗАПАСНАЯ РЕАЛЬНОСТЬ</b> отменила смерть','#ffbd3d');shake=1.4;}
    else if(s.hp<=0){s.hp=0;endGame(false);}
  }
  function nearestEnemies(x,z,range=99,count=1,exclude=[]) {
    return enemyCandidates(x,z,range).filter(e=>!e.dead&&!exclude.includes(e)&&((e.x-x)**2+(e.z-z)**2)<range*range&&!lineBlockedByObstacle(x,z,e.x,e.z,.08)).sort((a,b)=>((a.x-x)**2+(a.z-z)**2)-((b.x-x)**2+(b.z-z)**2)).slice(0,count);
  }
  function localCombatActor(){return coopActors.find(actor=>actor.local)||coopActors[0]||null}
  function enemyDisplayName(enemy){if(!enemy)return'ПРОТИВНИК';if(enemy.boss)return enemy.bossName||BOSS_ARCHETYPES[enemy.bossKind]?.name||'БОСС РАЗЛОМА';if(enemy.miniboss)return'СТРАЖ ПОЗДНЕГО РАЗЛОМА';const base=ENEMY_NAMES[enemy.type]||String(enemy.type||'ПРОТИВНИК').toUpperCase();return enemy.elite&&enemy.affixName?`${enemy.affixName} · ${base}`:base}
  function lockedEnemyForActor(actor=actorById(activeActorId),origin=player,range=Infinity){
    const entity=actor?.entity||player,nid=Math.max(0,Math.floor(Number(entity?.lockedTargetNid)||0));if(!nid)return null;const target=enemies.find(enemy=>enemy.nid===nid&&!enemy.dead);if(!target){entity.lockedTargetNid=0;return null}return dist2(target,origin)<range*range?target:null;
  }
  function actorHasTargetLock(actor=actorById(activeActorId)){return Boolean(Math.max(0,Math.floor(Number((actor?.entity||player)?.lockedTargetNid)||0)))}
  function aimedEnemy(x,z,range=99,actor=actorById(activeActorId)){
    if(actorHasTargetLock(actor)){const target=lockedEnemyForActor(actor,{x,z},range);return target&&!lineBlockedByObstacle(x,z,target.x,target.z,.08)?target:null;}
    return nearestEnemies(x,z,range,1)[0]||null;
  }
  function aimedEnemies(x,z,range=99,count=1,actor=actorById(activeActorId)){
    if(actorHasTargetLock(actor)){const target=lockedEnemyForActor(actor,{x,z},range);return target&&!lineBlockedByObstacle(x,z,target.x,target.z,.08)?Array.from({length:count},()=>target):[]}
    return nearestEnemies(x,z,range,count);
  }
  function updateTargetLockHud(){
    const actor=localCombatActor(),entity=actor?.entity||player,target=['playing','paused','remote','choice'].includes(state.mode)?lockedEnemyForActor(actor,entity,Infinity):null,hud=$('#targetLockHud'),active=Boolean(target);hud.classList.toggle('hidden',!active);document.body.classList.toggle('target-lock-active',active);canvas.dataset.targetMode=active?'locked':'auto';canvas.dataset.targetNid=active?String(target.nid):'';
    if(!target)return;$('#targetLockName').textContent=enemyDisplayName(target);$('#targetLockHp').textContent=`${Math.ceil(target.hp).toLocaleString('ru-RU')} / ${Math.ceil(target.maxHp).toLocaleString('ru-RU')} HP · ПКМ — АВТОРЕЖИМ`;$('#targetLockBar').style.transform=`scaleX(${clamp(target.hp/Math.max(1,target.maxHp),0,1)})`;
  }
  function notifyTargetMode(target){if(target){toast(`<b>ЗАХВАТ ЦЕЛИ</b> · ${enemyDisplayName(target)}<br><small>Направленные атаки сфокусированы · ПКМ — авторежим</small>`,'#38f3ff');audio.init();audio.tone(690,.09,'square',.024)}else{toast('<b>АВТОНАВЕДЕНИЕ</b> · выбрана ближайшая подходящая цель','#a56cff');audio.init();audio.tone(310,.08,'triangle',.02)}}
  function setLocalTarget(target){const actor=localCombatActor(),entity=actor?.entity||player;if(!target||target.dead)return;entity.lockedTargetNid=target.nid;entity.prismTarget=0;entity.prismLock=0;if(coopNet.mode==='guest')sendCoop({type:'target',targetNid:target.nid});notifyTargetMode(target);updateTargetLockHud()}
  function clearLocalTarget(notify=true){const actor=localCombatActor(),entity=actor?.entity||player,had=Boolean(entity?.lockedTargetNid);if(entity){entity.lockedTargetNid=0;entity.prismTarget=0;entity.prismLock=0}if(coopNet.mode==='guest')sendCoop({type:'target',targetNid:0});if(had&&notify)notifyTargetMode(null);updateTargetLockHud()}
  function clearTargetLocksForEnemy(enemy){for(const actor of coopActors){if(actor.entity?.lockedTargetNid!==enemy.nid)continue;actor.entity.lockedTargetNid=0;actor.entity.prismTarget=0;actor.entity.prismLock=0;if(actor.local)toast(`<b>ЦЕЛЬ УНИЧТОЖЕНА</b> · автоприцел восстановлен`,'#63ffb0')}if(!coopActors.length&&player.lockedTargetNid===enemy.nid){player.lockedTargetNid=0;player.prismTarget=0;player.prismLock=0}updateTargetLockHud()}
  function projectTargetPoint(x,y,z){const m=lastViewProjection;if(!m)return null;const cx=m[0]*x+m[4]*y+m[8]*z+m[12],cy=m[1]*x+m[5]*y+m[9]*z+m[13],cz=m[2]*x+m[6]*y+m[10]*z+m[14],cw=m[3]*x+m[7]*y+m[11]*z+m[15];if(cw<=.001)return null;const nx=cx/cw,ny=cy/cw,nz=cz/cw;if(nz< -1||nz>1||Math.abs(nx)>1.15||Math.abs(ny)>1.15)return null;const rect=canvas.getBoundingClientRect();return{x:rect.left+(nx*.5+.5)*rect.width,y:rect.top+(1-(ny*.5+.5))*rect.height,depth:nz}}
  function enemyAtScreen(clientX,clientY){let best=null,bestScore=Infinity,origin=(localCombatActor()?.entity||player);for(const enemy of enemies){if(enemy.dead||lineBlockedByObstacle(origin.x,origin.z,enemy.x,enemy.z,.08))continue;const center=projectTargetPoint(enemy.x,Math.max(.55,enemy.size*.9),enemy.z),top=projectTargetPoint(enemy.x,Math.max(1.1,enemy.size*2.05),enemy.z);if(!center)continue;const visualHeight=top?Math.abs(center.y-top.y):0,radius=clamp(visualHeight*1.1+7,16,82),dx=clientX-center.x,dy=clientY-center.y,d2=dx*dx+dy*dy;if(d2>radius*radius)continue;const score=d2/(radius*radius)+center.depth*.025;if(score<bestScore){best=enemy;bestScore=score}}return best}
  function echoCopies() {
    // Echo is read at attack time, so weapons unlocked after the relic inherit
    // it immediately. Values above 100% guarantee copies and roll the remainder.
    const power=Math.max(0,state.stats.echo),guaranteed=Math.floor(power),fraction=power-guaranteed;
    return guaranteed+(gameRandom()<fraction?1:0);
  }
  const AREA_DAMAGE_SOURCES=new Set(['aura','meteor','frost','firetrail','storm','voidPressure','corpseFire','killnova','critburst','riftScar','mines','mineLink','mortar','seismic','resonance','pyroblast','guardianNova','mimicSpecial']);
  const NON_RECURSIVE_SOURCES=new Set(['critburst','killnova','corpseFire','thorns','discharge','shardburst','unstableDuplicate','mineLink','riftScar','pyroblast','guardianNova']);
  function weaponLevel(id){return(state.weapons[id]||0)+((state.stats.forgeWeapons||[]).includes(id)?1:0);}
  function anchorActive(){return Boolean(state.stats.hunterAnchor&&player.stationaryTime>=2);}
  function riftwalkerActive(){if(state.hero!=='riftwalker')return false;if(state.map!=='obstacles')return Boolean(player.moving&&(player.inertiaCharge||0)>.8);return nearbyObstacles(player.x,player.z,2.4).some(obstacle=>Math.abs(player.x-obstacle.x)<obstacle.hx+2.1&&Math.abs(player.z-obstacle.z)<obstacle.hz+2.1);}
  function attackSize(){return state.stats.projSize*(anchorActive()?1+state.stats.hunterAnchor*.08:1);}
  function projectileSize(base){return base*attackSize();}
  function areaRadius(base){return base*attackSize()*Math.pow(.94,state.stats.blackPowder||0);}
  function zoneDuration(base){return base*state.stats.duration*Math.pow(1.08,state.stats.riftStabilizer||0);}
  function zoneCooldown(base){return base*(1+(state.stats.riftStabilizer||0)*.05);}
  function timedBuffStrength(){return Math.max(.6,1-(state.stats.reversedClock||0)*.03);}
  function timedBuffDuration(base){return base*state.stats.duration*Math.pow(1.08,state.stats.reversedClock||0);}
  function speedBuffMultiplier(){return(state.buffs.speed>0?1+.7*timedBuffStrength():1)*(state.buffs.duelist>0?1.25:1)*(riftwalkerActive()?1.12:1);}
  function doubleBuffMultiplier(){return state.buffs.double>0?1+timedBuffStrength():1;}
  function attackRateExtras(){const flywheel=1+(state.stats.inertiaFlywheel||0)*.12*(player.inertiaCharge||0),cleanup=1+(state.stats.cleanupStacks||0)*(state.stats.cleanupProtocol||0)*.02,missing=1-state.stats.hp/Math.max(1,state.stats.maxHp),berserk=state.hero==='berserker'?1+missing*.4:1,chrono=state.hero==='chronomancer'&&enemyCandidates(player.x,player.z,14).some(enemy=>!enemy.dead&&enemy.slow>0&&dist2(enemy,player)<14**2)?1.18:1;return flywheel*cleanup*berserk*chrono;}
  function densestEnemy(range=30){
    if(actorHasTargetLock()){const target=lockedEnemyForActor(actorById(activeActorId),player,range);if(!target)return{target:null,count:0};const count=enemyCandidates(target.x,target.z,4.5).reduce((total,enemy)=>total+(!enemy.dead&&dist2(target,enemy)<4.5**2?1:0),0);return{target,count}}
    const candidates=nearestEnemies(player.x,player.z,range,50);let best=null,bestCount=0;for(const candidate of candidates){let count=0;for(const e of candidates)if(!e.dead&&dist2(candidate,e)<4.5**2)count++;if(count>bestCount){best=candidate;bestCount=count;}}return{target:best,count:bestCount};
  }
  function distanceToSegmentSquared(point,a,b){const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;if(!length)return dist2(point,a);const t=clamp(((point.x-a.x)*dx+(point.z-a.z)*dz)/length,0,1),x=a.x+dx*t,z=a.z+dz*t;return(point.x-x)**2+(point.z-z)**2;}
  function spawnShardBurst(){
    const rank=state.stats.shardAccumulator;if(!rank)return;const count=8+rank*2,damage=8+rank*5,speed=14*state.stats.projSpeed;for(let i=0;i<count;i++){const a=i/count*TAU;spawnPlayerProjectile({owner:activeActorId,weapon:'shardburst',x:player.x,z:player.z,y:.85,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,life:1.45,damage,pierce:1+Math.floor(rank/2),size:projectileSize(.16),color:COLORS.white,kind:'shard',noAccumulator:true});}burst(player.x,player.z,COLORS.white,10,.75);
  }
  function storeSparePierce(p){const owner=actorById(p.owner);if(!owner||p.noAccumulator||!owner.stats.shardAccumulator||!(p.pierce>0))return;withActor(owner,()=>{state.stats.shardCharge=(state.stats.shardCharge||0)+Math.min(4,p.pierce);while(state.stats.shardCharge>=20){state.stats.shardCharge-=20;spawnShardBurst();}});}
  function activeBlasterAim(){
    const actor=actorById(activeActorId);if(actor?.local&&isFirstPerson())return{yaw:cameraYaw,pitch:cameraPitch};
    if(actor&&!actor.local&&actor.firstPerson&&Number.isFinite(actor.aimYaw))return{yaw:actor.aimYaw,pitch:clamp(Number(actor.aimPitch)||0,-.55,.45)};return null;
  }
  function extraProjectileCount(){return Math.max(0,Math.floor(Number(state.stats.projectiles)||1)-1);}
  function fireBlaster() {
    const cameraAim=activeBlasterAim(),target=cameraAim?null:aimedEnemy(player.x,player.z,25);if(!cameraAim&&!target)return;
    const level=weaponLevel('blaster'),evolved=hasEvolution('blaster'),total=state.stats.projectiles+Math.floor(level/4)+(evolved?2:0),base=cameraAim?.yaw??Math.atan2(target.z-player.z,target.x-player.x),pitch=cameraAim?.pitch||0,copies=1+echoCopies();
    for(let copy=0;copy<copies;copy++)for(let i=0;i<total;i++){
      const spread=(i-(total-1)/2)*.105+(copy?rand(.045,-.045):0),a=base+spread,speed=(15+level*.7)*state.stats.projSpeed,horizontal=speed*Math.cos(pitch),forward=cameraAim?1.05:0;
      spawnPlayerProjectile({owner:activeActorId,weapon:'blaster',x:player.x+Math.cos(base)*forward,z:player.z+Math.sin(base)*forward,y:cameraAim?1.48:1.05,vx:Math.cos(a)*horizontal,vz:Math.sin(a)*horizontal,vy:cameraAim?Math.sin(pitch)*speed:0,aim3d:Boolean(cameraAim),life:2.2,damage:(11+level*4)*(evolved?1.65:1),pierce:state.stats.pierce+Math.floor(level/3)+(evolved?3:0),size:projectileSize((.24+level*.015)*(evolved?1.4:1)),color:evolved?COLORS.green:copy?COLORS.violet:COLORS.cyan});
    }
    burst(player.x,player.z,COLORS.cyan,2,.35);audio.tone(390+level*22,.035,'square',.012);
  }
  function fireAura() {
    const l=weaponLevel('aura');if(!l)return;const evolved=hasEvolution('aura'),radius=areaRadius((3.1+l*.48)*(evolved?1.45:1)),copies=1+echoCopies();
    for(let copy=0;copy<copies;copy++){
      zones.push({owner:activeActorId,x:player.x,z:player.z,radius:radius*(1+copy*.025),life:.35+copy*.04,max:.35+copy*.04,color:copy?COLORS.cyan:COLORS.violet,kind:'pulse'});
      for(const e of enemyCandidates(player.x,player.z,radius))if(!e.dead&&dist2(player,e)<radius*radius)damageEnemy(e,(9+l*6)*(evolved?1.6:1),'aura');
    }
    audio.tone(180+l*15,.13,'sine',.018);
  }
  function fireLightning() {
    const l=weaponLevel('lightning');if(!l)return;const evolved=hasEvolution('lightning'),copies=1+echoCopies(),startCount=1+extraProjectileCount();
    for(let copy=0;copy<copies;copy++){
      const starts=aimedEnemies(player.x,player.z,22,startCount);for(let startIndex=0;startIndex<starts.length;startIndex++){
        let current=starts[startIndex],from={x:player.x,z:player.z};const hit=[],damageScale=startIndex===0?1:.55;
        for(let i=0;current&&i<2+l+state.stats.chainBonus+(evolved?3:0);i++){damageEnemy(current,(18+l*8)*(evolved?1.35:1)*damageScale,'lightning');beams.push({x1:from.x,z1:from.z,x2:current.x,z2:current.z,life:.13+copy*.025,max:.13+copy*.025,color:copy?COLORS.amber:startIndex?COLORS.green:i?COLORS.violet:COLORS.cyan,kind:'lightning'});hit.push(current);from=current;current=nearestEnemies(from.x,from.z,5.5+l*.25,1,hit)[0];}
        if(evolved&&startIndex===0&&hit.length){const anchor=hit[Math.floor(hit.length/2)],duration=zoneDuration(4);zones.push({owner:activeActorId,weapon:'lightning',x:anchor.x,z:anchor.z,radius:areaRadius(2.5),life:duration,max:duration,color:COLORS.cyan,kind:'storm',damage:8+l*2.5,tick:0});}
      }
    }
    audio.tone(760,.07,'sawtooth',.025);
  }
  function fireMeteor() {
    const l=weaponLevel('meteor');if(!l)return;const evolved=hasEvolution('meteor'),locked=actorHasTargetLock(),baseCount=Math.min(1+Math.floor(l/3)+(evolved?1:0),5),extra=extraProjectileCount(),targets=aimedEnemies(player.x,player.z,28,baseCount+extra),copies=1+echoCopies();
    for(let copy=0;copy<copies;copy++)for(let index=0;index<targets.length;index++){const t=targets[index],delay=(evolved?.62:.85)+copy*.08+index*.018,spread=locked?.38:1.5,extraDamage=index>=baseCount?.5:1;zones.push({owner:activeActorId,weapon:'meteor',x:t.x+rand(spread,-spread),z:t.z+rand(spread,-spread),radius:areaRadius((2.2+l*.28)*(evolved?1.4:1)),life:delay,max:delay,color:index>=baseCount?COLORS.white:copy?COLORS.white:COLORS.amber,kind:'meteor',damage:(28+l*12)*(evolved?1.7:1)*extraDamage});}
  }
  function fireSaw() {
    const l=weaponLevel('saw'),target=aimedEnemy(player.x,player.z,30);if(!l||!target)return;
    const evolved=hasEvolution('saw'),count=1+Math.floor(l/4)+(evolved?1:0)+extraProjectileCount(),base=Math.atan2(target.z-player.z,target.x-player.x),copies=1+echoCopies();
    for(let copy=0;copy<copies;copy++)for(let i=0;i<count;i++){const a=base+(i-(count-1)/2)*.2+(copy?rand(.08,-.08):0),speed=(9+l*.35)*state.stats.projSpeed;
      spawnPlayerProjectile({owner:activeActorId,weapon:'saw',x:player.x,z:player.z,y:.8,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,life:(2.8+l*.12)*state.stats.duration*(evolved?1.35:1),damage:(24+l*9)*(evolved?1.75:1),pierce:7+l*2+state.stats.pierce+(evolved?24:0),size:projectileSize((.52+l*.045)*(evolved?1.35:1)),color:copy?COLORS.violet:COLORS.green,kind:'saw',spin:0});
    }
    audio.tone(245,.12,'sawtooth',.018);
  }
  function fireFrost() {
    const l=weaponLevel('frost');if(!l)return;const evolved=hasEvolution('frost'),radius=areaRadius((4+l*.48)*(evolved?1.4:1)),copies=1+echoCopies();
    for(let copy=0;copy<copies;copy++){
      zones.push({owner:activeActorId,x:player.x,z:player.z,radius:radius*(1+copy*.03),life:.5+copy*.04,max:.5+copy*.04,color:copy?COLORS.violet:COLORS.cyan,kind:'frost'});
      for(const e of enemyCandidates(player.x,player.z,radius))if(!e.dead&&dist2(player,e)<radius*radius){damageEnemy(e,(12+l*6)*(evolved?1.45:1),'frost');e.slow=Math.max(e.slow,(2+l*.35)*(evolved?1.45:1));e.slowPower=Math.max(e.slowPower||0,evolved ? .82 : clamp(.42+l*.035,.42,.72));}
    }
    audio.tone(520,.24,'sine',.025);
  }
  function fireDrones() {
    const l=weaponLevel('drone');if(!l)return;const evolved=hasEvolution('drone'),baseCount=1+Math.floor(l/3)+(state.hero==='engineer'?1:0),count=baseCount+(evolved?Math.ceil(baseCount*.5):0),now=state.time*2.2,copies=1+echoCopies();
    for(let copy=0;copy<copies;copy++)for(let i=0;i<count;i++){const a=now+i/count*TAU,origin={x:player.x+Math.cos(a)*1.7,z:player.z+Math.sin(a)*1.7},target=aimedEnemy(origin.x,origin.z,25);if(!target)continue;
      const aim=Math.atan2(target.z-origin.z,target.x-origin.x),speed=19*state.stats.projSpeed;
      spawnPlayerProjectile({owner:activeActorId,weapon:'drone',x:origin.x,z:origin.z,y:1.35,vx:Math.cos(aim+copy*.025)*speed,vz:Math.sin(aim+copy*.025)*speed,life:1.7,damage:(8+l*3.5)*(evolved?1.55:1),pierce:1+Math.floor(l/4)+(evolved?2:0),size:projectileSize(.15*(evolved?1.2:1)),color:copy?COLORS.violet:COLORS.amber,kind:'drone'});
    }
    audio.tone(680,.025,'square',.009);
  }
  function fireGravity() {
    const l=weaponLevel('gravity'),target=aimedEnemy(player.x,player.z,27);if(!l||!target)return;
    const evolved=hasEvolution('gravity'),duration=zoneDuration((2.5+l*.3)*(evolved?1.35:1)),copies=1+echoCopies();
    for(let copy=0;copy<copies;copy++)zones.push({owner:activeActorId,weapon:'gravity',x:target.x+copy*1.1,z:target.z-copy*.8,radius:areaRadius((3.2+l*.35)*(evolved?1.45:1)),life:duration,max:duration,color:evolved?COLORS.amber:copy?COLORS.cyan:COLORS.violet,kind:'gravity',tick:copy*.04});
    audio.tone(95,.45,'sine',.035);
  }
  function fireFiretrail() {
    const l=weaponLevel('firetrail');if(!l||!player.moving)return;const evolved=hasEvolution('firetrail'),copies=1+echoCopies(),lanes=copies+(evolved?2:0),dir=player.moveDir??player.dir??0,duration=zoneDuration((2.2+l*.28)*(evolved?1.4:1));
    for(let copy=0;copy<lanes;copy++){
      const side=(copy-(lanes-1)/2)*(evolved?1.05:.8),x=player.x-Math.cos(dir)*.9+Math.cos(dir+Math.PI/2)*side,z=player.z-Math.sin(dir)*.9+Math.sin(dir+Math.PI/2)*side;
      zones.push({owner:activeActorId,weapon:'firetrail',x,z,radius:areaRadius((1.05+l*.1)*(evolved?1.35:1)),life:duration,max:duration,color:evolved?COLORS.amber:copy?COLORS.violet:COLORS.cyan,kind:'firetrail',damage:(5+l*2.8)*(1+state.stats.burnPower*.20)*(evolved?1.75:1),tick:copy*.04});
    }
  }

  function fireRiftLance() {
    const l=weaponLevel('riftlance'),target=aimedEnemy(player.x,player.z,34);if(!l||!target)return;const evolved=hasEvolution('riftlance'),copies=1+echoCopies(),shots=1+extraProjectileCount(),length=30+l*.7,width=projectileSize(.34+l*.035),limit=8+l-1+state.stats.pierce,locked=actorHasTargetLock(),aim=Math.atan2(target.z-player.z,target.x-player.x);
    for(let copy=0;copy<copies;copy++)for(let shot=0;shot<shots;shot++){const fan=locked||shot===0?0:(shot%2?1:-1)*Math.ceil(shot/2)*.075,base=aim+fan+(copy?rand(.045,-.045):0),dx=Math.cos(base),dz=Math.sin(base),beamLength=obstacleRayDistance(player.x,player.z,dx,dz,length,width*.35),end={x:player.x+dx*beamLength,z:player.z+dz*beamLength},hits=[],damageScale=shot===0?1:.5;
      for(const e of enemyCandidates(player.x+dx*beamLength*.5,player.z+dz*beamLength*.5,beamLength*.5+width+4)){if(e.dead)continue;const rx=e.x-player.x,rz=e.z-player.z,forward=rx*dx+rz*dz,side=Math.abs(rx*dz-rz*dx);if(forward>0&&forward<beamLength&&side<width+e.size)hits.push([forward,e]);}
      hits.sort((a,b)=>a[0]-b[0]);for(const [,e] of hits.slice(0,limit))damageEnemy(e,(32+(l-1)*7)*damageScale,'riftlance');beams.push({x1:player.x,z1:player.z,x2:end.x,z2:end.z,life:.16,max:.16,color:shot?COLORS.white:copy?COLORS.violet:COLORS.cyan,kind:'rift'});
      if(evolved&&shot===0&&beamLength>1){const duration=zoneDuration(1.8);for(let i=1;i<=6;i++)zones.push({owner:activeActorId,weapon:'riftScar',x:player.x+dx*beamLength*i/7,z:player.z+dz*beamLength*i/7,radius:areaRadius(.85+l*.035),life:duration,max:duration,color:COLORS.cyan,kind:'riftScar',damage:4.5+l*1.5,tick:i*.035});}
    }audio.tone(310,.11,'sawtooth',.02);
  }
  function fireBoomerang() {
    const l=weaponLevel('boomerang'),target=aimedEnemy(player.x,player.z,30);if(!l||!target)return;const evolved=hasEvolution('boomerang'),count=(evolved?3:1)+extraProjectileCount(),copies=1+echoCopies(),base=Math.atan2(target.z-player.z,target.x-player.x),speed=(10+l*.42)*state.stats.projSpeed;
    for(let copy=0;copy<copies;copy++)for(let i=0;i<count;i++){const a=base+(i-(count-1)/2)*.34+(copy?rand(.07,-.07):0),life=(2.45+l*.07)*state.stats.duration;spawnPlayerProjectile({owner:activeActorId,weapon:'boomerang',x:player.x,z:player.z,y:.9,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,life,returnAt:life*.52,returning:false,damage:18+(l-1)*4,returnDamage:(24+(l-1)*5)*(evolved?1.25:1),pierce:4+l+state.stats.pierce,size:projectileSize((.42+l*.025)*(evolved?1.18:1)),color:copy?COLORS.cyan:COLORS.violet,kind:'boomerang',spin:0});}audio.tone(270,.09,'triangle',.016);
  }
  function firePrism() {
    const l=weaponLevel('prism');if(!l)return;let target;if(actorHasTargetLock()){target=lockedEnemyForActor(actorById(activeActorId),player,27);if(!target||lineBlockedByObstacle(player.x,player.z,target.x,target.z,.08))return;if(player.prismTarget!==target.nid){player.prismTarget=target.nid;player.prismLock=0}}else{target=enemies.find(e=>e.nid===player.prismTarget&&!e.dead&&dist2(e,player)<27**2&&!lineBlockedByObstacle(player.x,player.z,e.x,e.z,.08));if(!target){target=nearestEnemies(player.x,player.z,27,1)[0];player.prismTarget=target?.nid||0;player.prismLock=0;}}if(!target)return;
    player.prismLock=Math.min(1,(player.prismLock||0)+.055+.008*l);const ramp=1+player.prismLock*.5,copies=1+echoCopies(),baseDamage=(2.65+l*.7)*ramp,extra=extraProjectileCount(),evolved=hasEvolution('prism');for(let copy=0;copy<copies;copy++){damageEnemy(target,baseDamage,'prism');beams.push({x1:player.x,z1:player.z,x2:target.x,z2:target.z,life:.105,max:.105,color:copy?COLORS.violet:COLORS.cyan,kind:'prism'});const evolutionTargets=evolved?nearestEnemies(target.x,target.z,7,3,[target]):[],extraTargets=extra?nearestEnemies(target.x,target.z,7,extra,[target,...evolutionTargets]):[];for(const other of evolutionTargets){damageEnemy(other,baseDamage*.45,'prism');beams.push({x1:target.x,z1:target.z,x2:other.x,z2:other.z,life:.1,max:.1,color:COLORS.white,kind:'prism'});}for(const other of extraTargets){damageEnemy(other,baseDamage*.45,'prism');beams.push({x1:player.x,z1:player.z,x2:other.x,z2:other.z,life:.1,max:.1,color:COLORS.green,kind:'prism'});}}
  }
  function fireMines() {
    const l=weaponLevel('mines');if(!l)return;const evolved=hasEvolution('mines'),copies=1,dir=player.moveDir??player.dir??0,maxCount=5+Math.floor(l/2)+(evolved?2:0);for(let copy=0;copy<copies;copy++){const side=(copy-(copies-1)/2)*.34,duration=zoneDuration(12+l*.45),mine={owner:activeActorId,weapon:'mines',x:player.x-Math.cos(dir)*1.1+Math.cos(dir+Math.PI/2)*side,z:player.z-Math.sin(dir)*1.1+Math.sin(dir+Math.PI/2)*side,radius:areaRadius(2.2+l*.08),triggerRadius:1.15+l*.04,life:duration,max:duration,color:copy?COLORS.white:evolved?COLORS.cyan:COLORS.amber,kind:'mine',damage:35+(l-1)*7,arm:.35,linkTick:0,seed:gameRandom()*TAU};zones.push(mine);}const owned=zones.filter(z=>z.kind==='mine'&&z.owner===activeActorId);while(owned.length>maxCount){const old=owned.shift(),index=zones.indexOf(old);if(index>=0)zones.splice(index,1);}}
  function fireMortar() {
    const l=weaponLevel('mortar'),cluster=densestEnemy(32);if(!l||!cluster.target)return 0;const evolved=hasEvolution('mortar'),baseShots=evolved?4:1,shots=baseShots+extraProjectileCount(),copies=1+echoCopies();for(let copy=0;copy<copies;copy++)for(let i=0;i<shots;i++){const delay=.74+i*.15+copy*.05,spread=i?1.8:1,extraDamage=i>=baseShots?.5:1;zones.push({owner:activeActorId,weapon:'mortar',x:cluster.target.x+rand(spread,-spread),z:cluster.target.z+rand(spread,-spread),radius:areaRadius((2.7+l*.13)*(evolved?1.12:1)),life:delay,max:delay,color:i>=baseShots?COLORS.white:copy?COLORS.white:COLORS.amber,kind:'mortar',damage:(42+(l-1)*9)*(evolved?.68:1)*extraDamage});}return cluster.count;
  }
  function fireChronoNeedles() {
    const l=weaponLevel('chrononeedles'),target=aimedEnemy(player.x,player.z,29);if(!l||!target)return;const count=Math.min(12,state.stats.projectiles+Math.floor((l-1)/3)),base=Math.atan2(target.z-player.z,target.x-player.x),speed=(22+l*.6)*state.stats.projSpeed,copies=1+echoCopies();for(let copy=0;copy<copies;copy++)for(let i=0;i<count;i++){const a=base+(i-(count-1)/2)*.065+(copy?rand(.035,-.035):0);spawnPlayerProjectile({owner:activeActorId,weapon:'chrononeedles',x:player.x,z:player.z,y:.95,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,life:1.5,damage:9+(l-1)*2.4,pierce:1+Math.floor(l/4),size:projectileSize(.105+l*.004),color:copy?COLORS.violet:COLORS.cyan,kind:'needle',chronoSlow:Math.min(.7,1.7+l*.14),chronoFreeze:hasEvolution('chrononeedles')});}
  }
  function fireSeismic() {
    const l=weaponLevel('seismic'),evolved=hasEvolution('seismic'),rings=evolved?3:1,copies=1+echoCopies();for(let copy=0;copy<copies;copy++)for(let i=0;i<rings;i++){const duration=.72+i*.06;zones.push({owner:activeActorId,weapon:'seismic',x:player.x,z:player.z,radius:areaRadius(6.2+l*.35+i*.5),life:duration,max:duration,color:copy?COLORS.cyan:i?COLORS.amber:COLORS.green,kind:'seismic',damage:(26+(l-1)*6)*(i===0?1:i===1?.82:.64),delay:i*.22+copy*.04,hit:new Set()});}audio.tone(105,.18,'sine',.025);
  }
  function naniteTarget(origin,excluded=new Set(),ownerId=activeActorId) {const actor=actorById(ownerId);if(actorHasTargetLock(actor)){const target=lockedEnemyForActor(actor,origin,32);return target&&!excluded.has(target)&&!excluded.has(target.nid)&&!lineBlockedByObstacle(origin.x,origin.z,target.x,target.z,.08)?target:null}const pool=enemyCandidates(origin.x,origin.z,32).filter(e=>!e.dead&&!excluded.has(e)&&!excluded.has(e.nid)&&dist2(e,origin)<32**2&&!lineBlockedByObstacle(origin.x,origin.z,e.x,e.z,.08));pool.sort((a,b)=>{const ap=(a.boss||a.miniboss||a.elite||['shooter','standard','absorber','warden'].includes(a.type))?0:1,bp=(b.boss||b.miniboss||b.elite||['shooter','standard','absorber','warden'].includes(b.type))?0:1;return ap-bp||dist2(a,origin)-dist2(b,origin)});return pool[0];}
  function spawnNanite(x,z,owner=activeActorId,damage=10,attacks=3,evolved=false){const target=naniteTarget({x,z},new Set(),owner);if(!target)return;const a=Math.atan2(target.z-z,target.x-x),speed=13;spawnPlayerProjectile({owner,weapon:'nanoswarm',x,z,y:.72,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,life:4.2,damage,pierce:attacks,attacksLeft:attacks,size:.16,color:evolved?COLORS.green:COLORS.cyan,kind:'nanite',targetNid:target.nid,homingSpeed:speed,evolvedNanite:evolved});}
  function fireNanoswarm() {const l=weaponLevel('nanoswarm');if(!l)return;const count=3+Math.floor((l-1)/2),attacks=3+Math.floor(l/4),copies=1+echoCopies(),evolved=hasEvolution('nanoswarm');for(let copy=0;copy<copies;copy++)for(let i=0;i<count;i++){const a=i/count*TAU+copy*.18;spawnNanite(player.x+Math.cos(a)*.7,player.z+Math.sin(a)*.7,activeActorId,6+l*2.2,attacks,evolved);}}
  function updateMirrorDisc(dt) {
    const l=weaponLevel('mirrordisc');if(!l)return;const dir=player.dir||0,x=player.x+Math.cos(dir)*1.25,z=player.z+Math.sin(dir)*1.25,evolved=hasEvolution('mirrordisc');state.stats.mirrorReflectCooldown=Math.max(0,(state.stats.mirrorReflectCooldown||0)-dt);
    for(const e of enemyCandidates(x,z,4.5+projectileSize(.62)))if(!e.dead&&(e.mirrorHit||0)<=0&&(e.x-x)**2+(e.z-z)**2<(e.size+projectileSize(.62))**2){damageEnemy(e,8+l*4,'mirrorDisc');e.mirrorHit=.42;}
    if(state.stats.mirrorReflectCooldown>0)return;for(let i=enemyProjectiles.length-1;i>=0;i--){const p=enemyProjectiles[i];if((p.x-x)**2+(p.z-z)**2>(.8+p.size)**2)continue;const reflectedDamage=p.damage,reflectedSize=p.size,reflectedVx=p.vx,reflectedVz=p.vz;removePooledAt(enemyProjectiles,i,'enemyProjectile');const locked=actorHasTargetLock()?lockedEnemyForActor(actorById(activeActorId),{x,z},40):null,base=locked?Math.atan2(locked.z-z,locked.x-x):Math.atan2(-reflectedVz,-reflectedVx),count=(evolved?3:1)+extraProjectileCount(),speed=Math.max(9,Math.hypot(reflectedVx,reflectedVz)*1.25);for(let j=0;j<count;j++){const a=base+(j-(count-1)/2)*.22;spawnPlayerProjectile({owner:activeActorId,weapon:'reflected',x,z,y:.85,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,life:3,damage:reflectedDamage*.5*(1+l*.08),pierce:2+Math.floor(l/3),size:projectileSize(Math.max(.16,reflectedSize*.85)),color:COLORS.white,kind:'reflected',preScaled:true,noAccumulator:true});}state.stats.mirrorReflectCooldown=Math.max(.3,(1.25-l*.1)*(evolved?.65:1));burst(x,z,COLORS.white,7,.55);break;}
  }
  function fireResonance() {
    const l=weaponLevel('resonance'),evolved=hasEvolution('resonance'),copies=1+echoCopies();state.stats.resonanceStacks=Math.min(10,(state.stats.resonanceStacks||0)+1);const stacks=state.stats.resonanceStacks,radius=areaRadius(4.4+l*.32),damage=(12+(l-1)*4)*(1+stacks*.15);for(let copy=0;copy<copies;copy++){zones.push({owner:activeActorId,weapon:'resonance',x:player.x,z:player.z,radius:radius*(1+copy*.025),life:.46,max:.46,color:copy?COLORS.cyan:COLORS.violet,kind:'pulse'});for(const e of enemyCandidates(player.x,player.z,radius))if(!e.dead&&dist2(player,e)<radius*radius)damageEnemy(e,damage,'resonance');}if(evolved&&stacks===10){const finalRadius=areaRadius(radius*1.5);zones.push({owner:activeActorId,weapon:'resonance',x:player.x,z:player.z,radius:finalRadius,life:.7,max:.7,color:COLORS.white,kind:'pulse'});for(const e of enemyCandidates(player.x,player.z,finalRadius))if(!e.dead&&dist2(player,e)<finalRadius*finalRadius)damageEnemy(e,damage*1.8,'resonance');state.stats.resonanceStacks=0;}audio.tone(190+stacks*30,.14,'sine',.018);
  }

  function spawnHeroProjectile(origin,target,weapon,damage,count=1,color=COLORS.white,speed=16){
    if(!target)return;const base=Math.atan2(target.z-origin.z,target.x-origin.x);for(let i=0;i<count;i++){const a=base+(i-(count-1)/2)*.13;spawnPlayerProjectile({owner:activeActorId,weapon,x:origin.x,z:origin.z,y:.8,vx:Math.cos(a)*speed*state.stats.projSpeed,vz:Math.sin(a)*speed*state.stats.projSpeed,life:2.2,damage,pierce:Math.max(1,Math.floor(state.stats.pierce/2)),size:projectileSize(.17),color,kind:'heroShot'});}
  }
  function updateHeroMechanics(dt){
    const s=state.stats;
    if(state.hero==='engineer'){s.heroClock-=dt;if(s.heroClock<=0){const a=gameRandom()*TAU,unit={kind:'turret',owner:activeActorId,x:player.x+Math.cos(a)*1.8,z:player.z+Math.sin(a)*1.8,life:34,max:34,attackClock:.15,seed:a};resolveObstacleOverlaps(unit,.42);heroUnits.push(unit);s.heroActivations=(s.heroActivations||0)+1;const owned=heroUnits.filter(item=>item.kind==='turret'&&item.owner===activeActorId);while(owned.length>2){const old=owned.shift(),index=heroUnits.indexOf(old);if(index>=0)heroUnits.splice(index,1);}s.heroClock=20;toast('<b>АВТОТУРЕЛЬ</b> · активна 34 секунды','#ffbd3d');}}
    if(state.hero==='chronomancer'){s.heroClock-=dt;if(s.heroClock<=0){const radius=9;zones.push({owner:activeActorId,x:player.x,z:player.z,radius,life:.7,max:.7,color:COLORS.cyan,kind:'frost'});for(const enemy of enemyCandidates(player.x,player.z,radius))if(!enemy.dead&&dist2(player,enemy)<radius*radius){enemy.slow=Math.max(enemy.slow,4);enemy.slowPower=Math.max(enemy.slowPower||0,.65);}s.heroClock=30;s.heroActivations=(s.heroActivations||0)+1;toast('<b>ХРОНОСФЕРА</b> · время вокруг замедлено','#38f3ff');}}
    if(state.hero==='mimic'){
      s.mimicShotClock-=dt;if(s.mimicShotClock<=0){const target=aimedEnemy(player.x,player.z,27);if(target)spawnHeroProjectile(player,target,'mimic',13+s.level*.32,Math.min(6,state.stats.projectiles),COLORS.white,17);s.mimicShotClock=.82/(state.stats.fireRate*attackRateExtras());}
      s.mimicSpecialClock-=dt;if(s.mimicSpecialClock<=0){const target=enemyCandidates(player.x,player.z,30).filter(enemy=>!enemy.dead&&(enemy.elite||enemy.boss||enemy.miniboss)&&dist2(player,enemy)<30**2&&!lineBlockedByObstacle(player.x,player.z,enemy.x,enemy.z,.08)).sort((a,b)=>(b.boss+b.miniboss)-(a.boss+a.miniboss)||dist2(a,player)-dist2(b,player))[0];if(target){const count=(target.boss||target.miniboss?6:3)+extraProjectileCount();spawnHeroProjectile(player,target,'mimicSpecial',22+s.level*.45,count,target.boss||target.miniboss?COLORS.amber:target.affixColor||COLORS.violet,14);const copied=enemyDisplayName(target);s.heroActivations=(s.heroActivations||0)+1;if(s.mimicCopied!==copied){s.mimicCopied=copied;toast(`<b>МИМИК СКОПИРОВАЛ АТАКУ</b> · ${copied}`,'#dcefff');}}s.mimicSpecialClock=11;}
    }
  }
  function updateHeroUnits(dt){
    for(let i=heroUnits.length-1;i>=0;i--){const unit=heroUnits[i],owner=actorById(unit.owner);unit.life-=dt;if(unit.life<=0||!owner){heroUnits.splice(i,1);continue;}unit.attackClock-=dt;
      if(unit.kind==='turret'){const target=nearestEnemies(unit.x,unit.z,26,1)[0];if(target&&unit.attackClock<=0){withActor(owner,()=>spawnHeroProjectile(unit,target,'engineerTurret',9+state.stats.level*.28,1,COLORS.amber,20));unit.attackClock=.52;}}
      else if(unit.kind==='minion'){const target=nearestEnemies(unit.x,unit.z,24,1)[0];if(target){const dx=target.x-unit.x,dz=target.z-unit.z,d=Math.hypot(dx,dz)||1;if(d>1.45)moveWithObstacles(unit,dx/d*5.2*dt,dz/d*5.2*dt,.32);else if(unit.attackClock<=0){withActor(owner,()=>damageEnemy(target,7+state.stats.level*.28,'necrominion'));unit.attackClock=.68;burst(target.x,target.z,COLORS.violet,2,.25);}}else{const dx=owner.entity.x-unit.x,dz=owner.entity.z-unit.z,d=Math.hypot(dx,dz)||1;if(d>4)moveWithObstacles(unit,dx/d*4*dt,dz/d*4*dt,.32);}}
    }
  }

  function updateWeapons(dt) {
    for(const k in state.cooldowns)state.cooldowns[k]-=dt;
    const rate=state.stats.fireRate*speedBuffMultiplier()*attackRateExtras();
    if(state.weapons.blaster&&state.cooldowns.blaster<=0){fireBlaster();state.cooldowns.blaster=.72/(rate*(1+weaponLevel('blaster')*.055));}
    if(state.weapons.aura&&state.cooldowns.aura<=0){fireAura();state.cooldowns.aura=zoneCooldown(1.7-weaponLevel('aura')*.07)/(rate*(hasEvolution('aura')?1.55:1));}
    if(state.weapons.lightning&&state.cooldowns.lightning<=0){fireLightning();state.cooldowns.lightning=(2.5-weaponLevel('lightning')*.11)/rate;}
    if(state.weapons.meteor&&state.cooldowns.meteor<=0){fireMeteor();state.cooldowns.meteor=zoneCooldown(4.2-weaponLevel('meteor')*.18)/rate;}
    if(state.weapons.saw&&state.cooldowns.saw<=0){fireSaw();state.cooldowns.saw=(2.3-weaponLevel('saw')*.08)/rate;}
    if(state.weapons.frost&&state.cooldowns.frost<=0){fireFrost();state.cooldowns.frost=zoneCooldown(3.4-weaponLevel('frost')*.12)/rate;}
    if(state.weapons.drone&&state.cooldowns.drone<=0){fireDrones();state.cooldowns.drone=(.78-weaponLevel('drone')*.035)/rate;}
    if(state.weapons.gravity&&state.cooldowns.gravity<=0){fireGravity();state.cooldowns.gravity=2*zoneCooldown(6-weaponLevel('gravity')*.22)/rate;}
    if(state.weapons.firetrail&&state.cooldowns.firetrail<=0){fireFiretrail();state.cooldowns.firetrail=zoneCooldown(.48-weaponLevel('firetrail')*.025)/rate;}
    if(state.weapons.riftlance&&state.cooldowns.riftlance<=0){fireRiftLance();state.cooldowns.riftlance=(1.6-weaponLevel('riftlance')*.045)/rate;}
    if(state.weapons.boomerang&&state.cooldowns.boomerang<=0){fireBoomerang();state.cooldowns.boomerang=(1.3-weaponLevel('boomerang')*.035)/rate;}
    if(state.weapons.prism&&state.cooldowns.prism<=0){firePrism();state.cooldowns.prism=.18/rate;}
    if(state.weapons.mines&&state.cooldowns.mines<=0){fireMines();state.cooldowns.mines=zoneCooldown(1.3-weaponLevel('mines')*.035)/rate;}
    if(state.weapons.mortar&&state.cooldowns.mortar<=0){const density=fireMortar()||0;state.cooldowns.mortar=zoneCooldown(2.4-weaponLevel('mortar')*.08)/(rate*(1+Math.min(.35,density*.015)));}
    if(state.weapons.chrononeedles&&state.cooldowns.chrononeedles<=0){fireChronoNeedles();state.cooldowns.chrononeedles=(.52-weaponLevel('chrononeedles')*.018)/rate;}
    if(state.weapons.seismic&&state.cooldowns.seismic<=0){fireSeismic();state.cooldowns.seismic=zoneCooldown(2.05-weaponLevel('seismic')*.055)/rate;}
    if(state.weapons.nanoswarm&&state.cooldowns.nanoswarm<=0){fireNanoswarm();state.cooldowns.nanoswarm=(2.25-weaponLevel('nanoswarm')*.07)/rate;}
    if(state.weapons.resonance&&state.cooldowns.resonance<=0){fireResonance();state.cooldowns.resonance=zoneCooldown(1.5-weaponLevel('resonance')*.04)/rate;}
    if(state.weapons.mirrordisc)updateMirrorDisc(dt);
    const l=weaponLevel('orbit');
    if(l){const evolved=hasEvolution('orbit'),count=2+Math.floor(l/2)+(evolved?3:0),r=(2.15+l*.12)*(evolved?1.15:1),now=state.time*(1.7+l*.09)*(evolved?1.18:1);
      for(let i=0;i<count;i++){const a=now+i/count*TAU,x=player.x+Math.cos(a)*r,z=player.z+Math.sin(a)*r;
        for(const e of enemyCandidates(x,z,4.5+projectileSize(.55)))if(!e.dead&&e.orbitHit<=0&&(e.x-x)**2+(e.z-z)**2<(e.size+projectileSize(.55))**2){const evolved=hasEvolution('orbit'),copies=1+echoCopies();for(let copy=0;copy<copies;copy++)damageEnemy(e,(7+l*3.2)*(evolved?1.7:1),'orbit');if(copies>1)burst(x,z,COLORS.violet,3,.35);e.orbitHit=evolved ? .14 : .18;}
      }
    }
  }
  function absorberBlocksProjectile(e,p) {
    if(e.type!=='absorber'||!e.absorbActive)return false;const target=closestActor(e),velocity=Math.hypot(p.vx,p.vz)||1;if(!target)return false;
    const dx=target.entity.x-e.x,dz=target.entity.z-e.z,d=Math.hypot(dx,dz)||1;
    return(-p.vx/velocity)*(dx/d)+(-p.vz/velocity)*(dz/d)>.15;
  }
  function updateProjectiles(dt) {
    for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i],owner=actorById(p.owner);
      if(p.kind==='nanite'&&p.naniteRehitClock>0){p.naniteRehitClock-=dt;if(p.naniteRehitClock<=0){p.hit.delete(p.naniteRehitNid);p.naniteRehitNid=0;}}
      if(p.kind==='boomerang'&&!p.returning&&p.life<=p.returnAt){p.returning=true;p.hit.clear();p.damage=p.returnDamage;p.color=COLORS.white;}
      if(p.kind==='boomerang'&&p.returning&&owner){const dx=owner.entity.x-p.x,dz=owner.entity.z-p.z,d=Math.hypot(dx,dz)||1,speed=Math.max(9,Math.hypot(p.vx,p.vz));p.vx=dx/d*speed;p.vz=dz/d*speed;}
      if(p.kind==='nanite'){let target=enemies.find(e=>e.nid===p.targetNid&&!e.dead&&!p.hit.has(e.nid));if(!target){target=naniteTarget(p,p.hit,p.owner);p.targetNid=target?.nid||0;}if(target){const dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz)||1,speed=p.homingSpeed||13;p.vx=lerp(p.vx,dx/d*speed,Math.min(1,dt*8));p.vz=lerp(p.vz,dz/d*speed,Math.min(1,dt*8));}}
      const previousX=p.x,previousZ=p.z;p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=(p.vy||0)*dt;p.life-=dt;if(['saw','boomerang'].includes(p.kind))p.spin=(p.spin||0)+dt*18;
      const obstacleHit=lineBlockedByObstacle(previousX,previousZ,p.x,p.z,Math.min(.45,p.size*.5));let remove=p.life<=0||p.y<-.5||p.y>32||obstacleHit||(p.kind==='boomerang'&&p.returning&&owner&&dist2(p,owner.entity)<.65**2);if(obstacleHit)burst(p.x,p.z,p.color,4,.38);
      if(!remove)for(const e of enemyCandidates(p.x,p.z,(p.size||.2)+5)){if(e.dead||p.hit.has(e.nid))continue;const rr=e.size+p.size,dy=p.aim3d?(p.y-Math.max(.7,e.size*.9))*.55:0;if((e.x-p.x)**2+(e.z-p.z)**2+dy*dy<rr*rr){p.hit.add(e.nid);if(absorberBlocksProjectile(e,p)){burst(p.x,p.z,COLORS.cyan,7,.45);remove=true;break;}withActor(owner,()=>damageEnemy(e,p.damage,p.weapon||'blaster',true,Boolean(p.preScaled)));if(p.chronoSlow){e.chronoStacks=Math.min(10,(e.chronoStacks||0)+1);e.slow=Math.max(e.slow,p.chronoSlow);e.slowPower=Math.max(e.slowPower||0,Math.min(.4,e.chronoStacks*.04));if(p.chronoFreeze&&e.chronoStacks>=10){e.slow=Math.max(e.slow,.75);e.slowPower=Math.max(e.slowPower,.96);e.chronoStacks=0;burst(e.x,e.z,COLORS.white,7,.55);}}p.pierce--;if(p.kind==='nanite'){p.attacksLeft=Math.max(0,(p.attacksLeft||1)-1);if(owner?.entity?.lockedTargetNid===e.nid&&p.attacksLeft>0){p.naniteRehitNid=e.nid;p.naniteRehitClock=.32;}}burst(p.x,p.z,p.color,2,.25);if(p.pierce<=0||(p.kind==='nanite'&&p.attacksLeft<=0)){remove=true;break;}}}
      if(remove){storeSparePierce(p);removePooledAt(projectiles,i,'projectile');}
    }
  }
  function updateEnemyProjectiles(dt) {
    for(let i=enemyProjectiles.length-1;i>=0;i--){const p=enemyProjectiles[i],previousX=p.x,previousZ=p.z;p.x+=p.vx*dt;p.z+=p.vz*dt;p.life-=dt;p.spin+=dt*5;
      if(lineBlockedByObstacle(previousX,previousZ,p.x,p.z,Math.min(.4,p.size*.55))){burst(p.x,p.z,p.color,4,.35);removePooledAt(enemyProjectiles,i,'enemyProjectile');continue;}
      const target=liveActors().find(actor=>{const rr=(actor.hero==='guardian'?.44:.58)+p.size;return(p.x-actor.entity.x)**2+(p.z-actor.entity.z)**2<rr*rr});
      if(target){withActor(target,()=>hurtPlayer(p.damage,null,p.bossDamage));burst(p.x,p.z,p.color,4,.35);removePooledAt(enemyProjectiles,i,'enemyProjectile');}
      else if(p.life<=0||!liveActors().some(actor=>dist2(p,actor.entity)<60*60))removePooledAt(enemyProjectiles,i,'enemyProjectile');
    }
  }
  function updateZones(dt) {
    for(let i=zones.length-1;i>=0;i--){const z=zones[i];if((z.delay||0)>0){z.delay-=dt;continue;}z.life-=dt;
      if(z.kind==='gravity'){
        const owner=actorById(z.owner);for(const e of enemyCandidates(z.x,z.z,z.radius)){if(e.dead||dist2(z,e)>=z.radius*z.radius)continue;const dx=z.x-e.x,dz=z.z-e.z,d=Math.hypot(dx,dz)||1,pullResistance=(e.boss||e.miniboss) ? .15 : e.affix==='relentless' ? .18 : 1,pull=(3.5+(owner?.weapons.gravity||0)*.7)*dt*pullResistance*(owner?.relics.evoGravity?1.8:1);moveWithObstacles(e,dx/d*pull,dz/d*pull,Math.max(.3,e.size*.52));}enemySpatialDirty=true;
        if(owner?.hero==='voidwalker'){z.tick=(z.tick??0)-dt;if(z.tick<=0){withActor(owner,()=>{const damage=(4+weaponLevel('gravity')*1.5)*(hasEvolution('gravity')?1.25:1),ownerKey=owner.id||'p1';for(const enemy of enemyCandidates(z.x,z.z,z.radius)){if(enemy.dead||dist2(z,enemy)>=z.radius*z.radius)continue;const nextHits=enemy.voidPressureNextHits||(enemy.voidPressureNextHits={});if((nextHits[ownerKey]||0)>state.time)continue;nextHits[ownerKey]=state.time+VOID_PRESSURE_TICK_INTERVAL;damageEnemy(enemy,damage,'voidPressure',false)}});z.tick=VOID_PRESSURE_TICK_INTERVAL;}}
      }
      if(z.kind==='firetrail'){
        z.tick-=dt;if(z.tick<=0){withActor(actorById(z.owner),()=>{for(const e of enemyCandidates(z.x,z.z,z.radius))if(!e.dead&&dist2(z,e)<z.radius*z.radius){e.burnTime=Math.max(e.burnTime||0,.65);damageEnemy(e,z.damage,z.weapon||'firetrail',false)}});z.tick=.3;}
      }
      if(z.kind==='storm'){
        z.tick-=dt;if(z.tick<=0){withActor(actorById(z.owner),()=>{for(const e of enemyCandidates(z.x,z.z,z.radius))if(!e.dead&&dist2(z,e)<z.radius*z.radius)damageEnemy(e,z.damage,'storm',false)});z.tick=.34;}
      }
      if(z.kind==='riftScar'){z.tick-=dt;if(z.tick<=0){withActor(actorById(z.owner),()=>{for(const e of enemyCandidates(z.x,z.z,z.radius))if(!e.dead&&dist2(z,e)<z.radius*z.radius)damageEnemy(e,z.damage,'riftScar',false)});z.tick=.34;}}
      if(z.kind==='mine'){
        z.arm-=dt;if(z.arm<=0&&enemyCandidates(z.x,z.z,z.triggerRadius).some(e=>!e.dead&&dist2(z,e)<z.triggerRadius*z.triggerRadius)){withActor(actorById(z.owner),()=>{for(const e of enemyCandidates(z.x,z.z,z.radius))if(!e.dead&&dist2(z,e)<z.radius*z.radius)damageEnemy(e,z.damage,'mines')});burst(z.x,z.z,z.color,15,1.1);z.kind='blast';z.life=.28;z.max=.28;}
        else if(z.arm<=0&&actorById(z.owner)?.relics.evoMines){z.linkTick-=dt;if(z.linkTick<=0){const other=zones.filter(other=>other!==z&&other.kind==='mine'&&other.owner===z.owner&&other.arm<=0&&other.seed>z.seed&&!lineBlockedByObstacle(z.x,z.z,other.x,other.z,.08)).sort((a,b)=>dist2(z,a)-dist2(z,b))[0];if(other&&dist2(z,other)<12**2){beams.push({x1:z.x,z1:z.z,x2:other.x,z2:other.z,life:.16,max:.16,color:COLORS.cyan,kind:'lightning'});const mx=(z.x+other.x)*.5,mz=(z.z+other.z)*.5,range=Math.hypot(other.x-z.x,other.z-z.z)*.5+4;withActor(actorById(z.owner),()=>{for(const e of enemyCandidates(mx,mz,range))if(!e.dead&&distanceToSegmentSquared(e,z,other)<(.38+e.size*.35)**2)damageEnemy(e,z.damage*.18,'mineLink',false)});}z.linkTick=.42;}}
      }
      if(z.kind==='seismic'){const progress=1-z.life/z.max,current=z.radius*clamp(progress,0,1),band=.75;for(const e of enemyCandidates(z.x,z.z,Math.min(z.radius,current+band+5))){if(e.dead||z.hit.has(e.nid))continue;const distance=Math.sqrt(dist2(z,e));if(Math.abs(distance-current)>band+e.size*.35)continue;z.hit.add(e.nid);const distanceRatio=clamp(distance/Math.max(.001,z.radius),0,1),radialDamage=lerp(1,SEISMIC_EDGE_DAMAGE_MULTIPLIER,distanceRatio);withActor(actorById(z.owner),()=>damageEnemy(e,z.damage*radialDamage*((e.boss||e.miniboss)?1.3:1),'seismic'));if(!(e.boss||e.miniboss)){const dx=e.x-z.x,dz=e.z-z.z,d=distance||1;moveWithObstacles(e,dx/d*.7,dz/d*.7,Math.max(.3,e.size*.52));}}}
      if(z.kind==='enemyTrap'&&z.life<=0&&!z.exploded){z.exploded=true;for(const actor of liveActors())if(dist2(z,actor.entity)<z.radius*z.radius)withActor(actor,()=>hurtPlayer(z.damage||12,enemies.find(enemy=>enemy.nid===z.source)));burst(z.x,z.z,COLORS.red,12,.85);shake=Math.min(1.1,shake+.18);audio.tone(115,.18,'sawtooth',.03);z.life=.3;z.max=.3;z.kind='enemyBlast';}
      if(z.kind==='meteor'&&z.life<=0&&!z.exploded){z.exploded=true;withActor(actorById(z.owner),()=>{for(const e of enemyCandidates(z.x,z.z,z.radius))if(!e.dead&&dist2(z,e)<z.radius*z.radius)damageEnemy(e,z.damage,z.weapon||'meteor')});burst(z.x,z.z,z.color,18,1.4);shake=Math.min(1.2,shake+.35);audio.tone(85,.2,'sawtooth',.04);z.life=.28;z.max=.28;z.kind='blast';}
      if(z.kind==='mortar'&&z.life<=0&&!z.exploded){z.exploded=true;withActor(actorById(z.owner),()=>{for(const e of enemyCandidates(z.x,z.z,z.radius))if(!e.dead&&dist2(z,e)<z.radius*z.radius)damageEnemy(e,z.damage,'mortar')});burst(z.x,z.z,z.color,16,1.2);z.life=.28;z.max=.28;z.kind='blast';}
      else if(z.life<=0)zones.splice(i,1);
    }
    for(let i=beams.length-1;i>=0;i--){beams[i].life-=dt;if(beams[i].life<=0)beams.splice(i,1);}
  }
  function resolveEnemyCrowding(dt) {
    if(enemies.length<2)return;
    const cellSize=2.6,grid=new Map(),live=[];
    for(const enemy of enemies){
      if(enemy.dead)continue;live.push(enemy);
      const cx=Math.floor(enemy.x/cellSize),cz=Math.floor(enemy.z/cellSize),key=`${cx}:${cz}`,bucket=grid.get(key);
      if(bucket)bucket.push(enemy);else grid.set(key,[enemy]);
    }
    const smallCorrection=Math.min(.82,dt*42),normalCorrection=Math.min(.54,dt*22),maxChecks=32,neighborOffsets=[[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    for(const enemy of live){
      const cx=Math.floor(enemy.x/cellSize),cz=Math.floor(enemy.z/cellSize);let checks=0;
      neighborCells:for(const [ox,oz] of neighborOffsets){
        const bucket=grid.get(`${cx+ox}:${cz+oz}`);if(!bucket)continue;
        const start=Math.abs((enemy.nid||0)*17+ox*7+oz*13)%bucket.length;
        for(let index=0;index<bucket.length;index++){
          const other=bucket[(start+index)%bucket.length];if(other===enemy)continue;if(checks++>=maxChecks)break neighborCells;
          const bothSmall=Math.max(enemy.size,other.size)<.8,minDistance=bothSmall?Math.max(.82,(enemy.size+other.size)*.9):Math.max(.56,(enemy.size+other.size)*.64),dx=other.x-enemy.x,dz=other.z-enemy.z,d2=dx*dx+dz*dz;if(d2>=minDistance*minDistance)continue;
          let nx,nz,distance;if(d2<.000001){const low=Math.min(enemy.nid||0,other.nid||0),high=Math.max(enemy.nid||0,other.nid||0),angle=((low*92821+high*68917)%6283)/1000,direction=(enemy.nid||0)<(other.nid||0)?1:-1;nx=Math.cos(angle)*direction;nz=Math.sin(angle)*direction;distance=0;}else{distance=Math.sqrt(d2);nx=dx/distance;nz=dz/distance;}
          const enemyMass=Math.max(.08,enemy.size*enemy.size)*(enemy.boss||enemy.miniboss?7:enemy.chargeTime>0?5:1),otherMass=Math.max(.08,other.size*other.size)*(other.boss||other.miniboss?7:other.chargeTime>0?5:1),enemyInverse=1/enemyMass,otherInverse=1/otherMass,inverseTotal=enemyInverse+otherInverse,correction=(minDistance-distance)*(bothSmall?smallCorrection:normalCorrection),enemyShare=enemyInverse/inverseTotal,otherShare=otherInverse/inverseTotal;
          enemy.x-=nx*correction*enemyShare;enemy.z-=nz*correction*enemyShare;other.x+=nx*correction*otherShare;other.z+=nz*correction*otherShare;
        }
      }
    }
  }
  function updateEnemies(dt) {
    const timeSpeed=enemyTimeSpeed(),lateScale=post15Scales();activeStandards=enemies.filter(enemy=>!enemy.dead&&enemy.type==='standard'&&enemy.burrowWindup<=0);
    for(const e of enemies){if(e.dead)continue;e.hit=Math.max(0,e.hit-dt);e.orbitHit=Math.max(0,e.orbitHit-dt);e.mirrorHit=Math.max(0,(e.mirrorHit||0)-dt);e.slow=Math.max(0,e.slow-dt);e.burnTime=Math.max(0,(e.burnTime||0)-dt);if(e.burnTime<=0)e.pyroBurnStacks=0;e.bossPhaseInvuln=Math.max(0,(e.bossPhaseInvuln||0)-dt);
      if(e.burrowWindup>0){e.burrowWindup-=dt;if(e.burrowWindup<=0){e.burrowWindup=0;burst(e.x,e.z,COLORS.red,13,.8);if(e.bossBurrowAttack){fireBossRadial(e,14,.38);e.bossBurrowAttack=false;}audio.tone(105,.16,'sawtooth',.025);}continue;}
      if(e.type==='absorber'){e.absorbClock-=dt;if(e.absorbClock<=0){e.absorbActive=!e.absorbActive;e.absorbClock=e.absorbActive?rand(4.2,3.2):rand(3,2.2);burst(e.x,e.z,e.absorbActive?COLORS.cyan:COLORS.violet,6,.45);}}
      const target=closestActor(e);if(!target)continue;if(updateBossSpecial(e,target,dt))continue;const targetPlayer=target.entity;let dx=targetPlayer.x-e.x,dz=targetPlayer.z-e.z,d=Math.hypot(dx,dz)||1;
      const bossLike=e.boss||e.miniboss,controlScale=bossLike?Math.min(e.affix==='relentless'?.2:1,.35):(e.affix==='relentless'?.2:1),slowPower=(e.slowPower||.5)*controlScale,slow=e.slow>0?1-slowPower:1,standardBoost=!bossLike&&e.type!=='standard'&&enemyCandidates(e.x,e.z,8.2).some(standard=>standard.type==='standard'&&!standard.dead&&standard.burrowWindup<=0&&dist2(e,standard)<8.2**2),speed=e.speed*slow*timeSpeed*lateScale.speed*(standardBoost?1.28:1);let contactMult=1;
      if(bossLike&&e.bossWaveWindup>0){/* Босс замирает на коротком читаемом замахе. */}
      else if(bossLike&&e.bossDashTime>0){if(!moveWithObstacles(e,e.bossDashVx*dt,e.bossDashVz*dt,Math.max(.3,e.size*.52)))e.bossDashTime=0;else e.bossDashTime-=dt;contactMult=1.3;}
      else if(bossLike&&e.bossDashWindup>0){e.bossDashWindup-=dt;if(e.bossDashWindup<=0){const al=Math.hypot(dx,dz)||1;e.bossDashVx=dx/al*speed*7;e.bossDashVz=dz/al*speed*7;e.bossDashTime=.72;}}
      else if(bossLike){moveWithObstacles(e,dx/d*speed*dt,dz/d*speed*dt,Math.max(.3,e.size*.52));if(e.miniboss||e.bossCanDash){e.bossDashClock-=dt*bossActionTempo();if(e.bossDashClock<=0&&d>4&&d<25){e.bossDashWindup=.55;e.bossDashClock=e.miniboss?rand(13,10):rand(10,8);beams.push({x1:e.x,z1:e.z,x2:targetPlayer.x,z2:targetPlayer.z,life:.55,max:.55,color:COLORS.red});}}}
      else if(e.type==='charger'){
        if(e.chargeTime>0){if(!moveWithObstacles(e,e.chargeVx*dt,e.chargeVz*dt,Math.max(.3,e.size*.52)))e.chargeTime=0;else e.chargeTime-=dt;contactMult=1.45;}
        else if(e.chargeWindup>0){e.chargeWindup-=dt;if(e.chargeWindup<=0){const ax=targetPlayer.x-e.x,az=targetPlayer.z-e.z,al=Math.hypot(ax,az)||1;e.chargeVx=ax/al*speed*3.5;e.chargeVz=az/al*speed*3.5;e.chargeTime=.68;}}
        else{moveWithObstacles(e,dx/d*speed*dt,dz/d*speed*dt,Math.max(.3,e.size*.52));e.chargeClock-=dt;if(e.chargeClock<=0&&d>4&&d<21){e.chargeWindup=.38;e.chargeClock=rand(6.2,4.1);beams.push({x1:e.x,z1:e.z,x2:targetPlayer.x,z2:targetPlayer.z,life:.38,max:.38,color:COLORS.red});}}
      }else if(e.type==='shooter'){
        const move=d>14?1:d<8?-.72:0,strafe=Math.sin(state.time*1.7+e.seed)*.2;moveWithObstacles(e,(dx/d*move-dz/d*strafe)*speed*dt,(dz/d*move+dx/d*strafe)*speed*dt,Math.max(.3,e.size*.52));
        e.rangedAttack-=dt;if(e.rangedAttack<=0&&d<26&&!lineBlockedByObstacle(e.x,e.z,targetPlayer.x,targetPlayer.z,.08)){withActor(target,()=>fireEnemyShot(e));e.rangedAttack=rand(4.4,3);}
      }else{moveWithObstacles(e,dx/d*speed*dt,dz/d*speed*dt,Math.max(.3,e.size*.52));}
      if(bossLike){
        const hpRatio=e.hp/e.maxHp;if(hpRatio<=.7&&!(e.bossSummonMask&1))triggerBossPhase(e,1);else if(hpRatio<=.35&&!(e.bossSummonMask&2))triggerBossPhase(e,2);
        if(e.bossWaveWindup>0){e.bossWaveWindup-=dt;if(e.bossWaveWindup<=0){e.bossWaveWindup=0;fireBossShockwave(e);}}
        else if(e.miniboss||e.bossCanWave){e.bossWaveClock-=dt*bossActionTempo();if(e.bossWaveClock<=0&&d<7.8&&e.bossDashTime<=0&&e.bossDashWindup<=0){e.bossWaveWindup=.78;e.bossWaveClock=e.miniboss?rand(17,14):rand(14,11);zones.push({x:e.x,z:e.z,radius:7.2,life:.78,max:.78,color:COLORS.red,kind:'enemyWarning'});}}
        if((e.miniboss||e.bossCanVolley)&&e.bossWaveWindup<=0&&e.bossDashWindup<=0&&e.bossDashTime<=0){e.bossAttack-=dt*bossActionTempo();if(e.bossAttack<=0&&!lineBlockedByObstacle(e.x,e.z,targetPlayer.x,targetPlayer.z,.12)){withActor(target,()=>fireBossVolley(e));e.bossAttack=e.miniboss?rand(7.8,5.6):rand(8.5,5.8);}}
      }
      dx=targetPlayer.x-e.x;dz=targetPlayer.z-e.z;d=Math.hypot(dx,dz)||1;
      const meleeRange=e.size*.56+(target.hero==='guardian'?.3:.42);
      if(d<meleeRange){withActor(target,()=>{const canVampire=e.affix==='vampiric'&&state.invuln<=0&&state.buffs.immortal<=0;hurtPlayer(e.damage*contactMult,e);if(canVampire)e.hp=Math.min(e.maxHp,e.hp+e.maxHp*.12)});}
    }
    resolveEnemyCrowding(dt);if(obstacles.length)for(const enemy of enemies)if(!enemy.dead)resolveObstacleOverlaps(enemy,Math.max(.3,enemy.size*.52));
    for(let i=enemies.length-1;i>=0;i--)if(enemies[i].dead||!liveActors().some(actor=>dist2(enemies[i],actor.entity)<75*75))removePooledAt(enemies,i,'enemy');enemySpatialDirty=true;
    state.spawnClock-=dt;
    const rate=Math.max(.1,enemyGrowth().spawn*state.difficulty.spawn*lateScale.spawn);
    const cap=Math.min(900,Math.floor(520*state.difficulty.spawn));
    const timeline=runTimelineTime();if(state.spawnClock<=0){const interval=1/rate,waves=Math.min(24,1+Math.floor(-state.spawnClock/interval)),surgeChance=timeline>=1200?.32:timeline>=600?.24:0;let requested=0;state.spawnClock+=waves*interval;for(let wave=0;wave<waves;wave++)requested+=gameRandom()<surgeChance?(timeline>=1200?4:3):1;const room=Math.max(0,cap-enemies.length),spawned=Math.min(requested,room);for(let i=0;i<spawned;i++)applySpawnThreatWeight(spawnEnemy());const blocked=requested-spawned;if(blocked>0)state.spawnThreatBank=Math.min(SPAWN_THREAT_BANK_CAP,(state.spawnThreatBank||0)+blocked);}
    const bossTimes=scheduledBossTimes();if(state.bossIndex<bossTimes.length&&timeline>=bossTimes[state.bossIndex]){spawnBoss('',state.bossIndex===0?.5:1);state.bossIndex++;}
  }
  function updateGems(dt) {
    for(let i=gems.length-1;i>=0;i--){const g=gems[i];g.life-=dt;g.vx*=Math.pow(.02,dt);g.vz*=Math.pow(.02,dt);g.x+=g.vx*dt;g.z+=g.vz*dt;
      const target=closestActor(g);if(!target){if(g.life<=0)removePooledAt(gems,i,'gem');continue;}const dx=target.entity.x-g.x,dz=target.entity.z-g.z,d=Math.hypot(dx,dz),pickup=target.buffs.magnet>0?120*Math.max(.6,1-(target.stats.reversedClock||0)*.03):target.stats.pickup;
      if(d<pickup){const speed=(target.buffs.magnet>0?32:9)+(pickup-d)*.7;g.x+=dx/(d||1)*speed*dt;g.z+=dz/(d||1)*speed*dt;}
      if(d<.75){withActor(target,()=>gainXP(g.value));audio.tone(620+Math.min(300,g.value*10),.025,'sine',.009);removePooledAt(gems,i,'gem');}else if(g.life<=0)removePooledAt(gems,i,'gem');
    }
  }
  function updateConsumables(dt) {
    for(let i=consumables.length-1;i>=0;i--){const c=consumables[i];c.life-=dt;const target=closestActor(c);if(!target){if(c.life<=0)removePooledAt(consumables,i,'consumable');continue;}const dx=target.entity.x-c.x,dz=target.entity.z-c.z,d=Math.hypot(dx,dz);
      if(d<3){c.x+=dx/(d||1)*5*dt;c.z+=dz/(d||1)*5*dt;}
      if(d<1){withActor(target,()=>activateConsumable(c.type));removePooledAt(consumables,i,'consumable');}else if(c.life<=0)removePooledAt(consumables,i,'consumable');
    }
  }
  function spawnWorldTotem() {
    const focus=spawnFocus(),a=gameRandom()*TAU,d=rand(17,12);worldTotems.push({x:focus.x+Math.cos(a)*d,z:focus.z+Math.sin(a)*d,life:95,seed:gameRandom()*TAU});
    toast('<b>ТОТЕМ СЛОЖНОСТИ</b> пробудился неподалёку','#ff3f68');audio.tone(82,.5,'sawtooth',.04);
  }
  function updateWorldTotems(dt) {
    if(state.time>=state.nextTotem){if(!worldTotems.length)spawnWorldTotem();state.nextTotem+=pacedDelay(240);}
    for(let i=worldTotems.length-1;i>=0;i--){const t=worldTotems[i];t.life-=dt;
      const target=closestActor(t);if(!target)continue;
      if(dist2(t,target.entity)>52*52){const a=gameRandom()*TAU;t.x=target.entity.x+Math.cos(a)*16;t.z=target.entity.z+Math.sin(a)*16;}
      if(dist2(t,target.entity)<1.8*1.8){worldTotems.splice(i,1);withActor(target,()=>requestChoice('totem'));break;}
      if(t.life<=0){worldTotems.splice(i,1);toast('Тотем сложности погас, не найдя носителя','#778196');}
    }
  }
  function updateThreat() {
    const now=state.time,t=runTimelineTime(now),base=t<600?t/90:t<1200?600/90+(t-600)/60:t<1800?600/90+600/60+(t-1200)/40:600/90+600/60+600/40+(t-1800)/25,progress=base*(state.difficulty.threatRate??1);
    const nextTier=Math.min(state.endless?99:29,Math.floor(progress));
    if(nextTier<=state.threatTier)return;
    const oldTier=state.threatTier,oldGrowth=enemyGrowth(now,oldTier),newGrowth=enemyGrowth(now,nextTier),healthScale=newGrowth.health/oldGrowth.health,damageScale=newGrowth.damage/oldGrowth.damage,speedScale=(1+nextTier*.008*(state.difficulty.scaling??1))/(1+oldTier*.008*(state.difficulty.scaling??1));
    state.threatTier=nextTier;
    for(const e of enemies){if(e.dead)continue;e.hp*=healthScale;e.maxHp*=healthScale;e.damage*=damageScale;e.speed*=speedScale;}
    toast(`<b>УГРОЗА ${threatLabel(nextTier)}</b> · враги эволюционировали`,'#ff3f68');shake=Math.min(1.1,shake+.55);audio.tone(Math.max(42,92-nextTier*2),.5,'sawtooth',.045);
  }
  function updateLateScale() {
    if(runTimelineTime()<600)return;
    const target=post15Scales(),healthRatio=target.health/state.lateHealthScale,damageRatio=target.damage/state.lateDamageScale;
    if(Math.abs(healthRatio-1)>.000001||Math.abs(damageRatio-1)>.000001){for(const e of enemies){if(e.dead)continue;e.hp*=healthRatio;e.maxHp*=healthRatio;e.damage*=damageRatio;}state.lateHealthScale=target.health;state.lateDamageScale=target.damage;}
    if(!state.lateScaleAnnounced){state.lateScaleAnnounced=true;if((state.difficulty.rift??1)>0){toast('<b>КРИТИЧЕСКИЙ РАЗЛОМ</b> · поздний скейлинг ускоряется до самого финала','#ff3f68');shake=1.15;audio.tone(64,.7,'sawtooth',.065);}updateUI(true);}
  }
  function triggerHorde(milestone=0) {
    const base=milestone===1?300:milestone===2?480:100+state.threatTier*12,hordeSize=state.difficulty.hordeSize??1,amount=Math.floor(Math.min((milestone?700:450)*hordeSize,base*Math.sqrt(state.difficulty.spawn)*hordeSize));
    queueHorde(amount);state.hordes++;state.nextHorde=state.time+pacedDelay(rand(300,180)*(state.difficulty.hordeInterval??1));
    $('#hordeCount').textContent=`${amount} ВРАГОВ В ПУТИ`;
    const banner=$('#hordeBanner');banner.classList.add('hidden');void banner.offsetWidth;banner.classList.remove('hidden');setTimeout(()=>banner.classList.add('hidden'),3600);
    toast(milestone?`<b>РУБЕЖ ${formatTime(pacedDelay(milestone===1?600:1200))}</b> · Страж и ${amount} врагов вошли в Разлом`:`<b>ОРДА №${state.hordes}</b> · ${amount} врагов окружают арену`,'#ff3f68');shake=1.25;audio.tone(58,.9,'sawtooth',.075);
  }
  function updateMilestones() {
    const times=[600,1200],timeline=runTimelineTime();
    while(state.milestoneIndex<times.length&&timeline>=times[state.milestoneIndex]){const stage=state.milestoneIndex;spawnMiniBoss(stage);triggerHorde(stage+1);state.milestoneIndex++;}
  }
  function queueHorde(amount,duration=pacedDelay(10)) {
    amount=Math.max(0,Math.floor(amount));if(!amount)return;
    state.hordeRemaining=(state.hordeRemaining||0)+amount;state.hordeDuration=Math.max(1,duration);state.hordeSpawnRate=state.hordeRemaining/state.hordeDuration;state.hordeSpawnBudget=0;
  }
  function updateHordes(dt) {
    if(state.hordeRemaining<=0&&state.time>=state.nextHorde)triggerHorde();
    if(state.hordeRemaining<=0)return;
    state.hordeDuration=Math.max(0,(state.hordeDuration||0)-dt);state.hordeSpawnBudget=(state.hordeSpawnBudget||0)+(state.hordeSpawnRate||state.hordeRemaining/10)*dt;
    if(state.hordeDuration<=0)state.hordeSpawnBudget=Math.max(state.hordeSpawnBudget,state.hordeRemaining);
    const room=Math.max(0,950-enemies.length),ready=Math.floor(state.hordeSpawnBudget),batch=Math.min(24,ready,state.hordeRemaining,room);
    if(batch<=0){state.hordeSpawnBudget=Math.min(state.hordeSpawnBudget,Math.max(4,(state.hordeSpawnRate||1)*1.5));return;}
    for(let i=0;i<batch;i++){
      const late=runTimelineTime()>=600,roll=gameRandom(),type=late?(roll<.30?'swarm':roll<.55?'runner':pickEnemyType()):(roll<.48?'swarm':gameRandom()<.38?'runner':pickEnemyType()),e=applySpawnThreatWeight(spawnEnemy(type)),focus=spawnFocus(),a=gameRandom()*TAU,d=rand(30,21);
      placeEnemy(e,focus.x+Math.cos(a)*d,focus.z+Math.sin(a)*d);
    }
    state.hordeRemaining-=batch;state.hordeSpawnBudget=Math.max(0,state.hordeSpawnBudget-batch);
    if(state.hordeRemaining===0){state.hordeDuration=0;state.hordeSpawnRate=0;state.hordeSpawnBudget=0;toast('<b>ОРДА ПОЛНОСТЬЮ ВОШЛА</b> · держи позицию','#ffbd3d');}
  }
  function updateParticles(dt) {
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=p.vy*dt;p.vy-=9*dt;if(p.y<.05){p.y=.05;p.vy*=-.25;}if(p.life<=0)removePooledAt(particles,i,'particle');}
  }
  function updatePlayer(dt,input=null) {
    let movement=input||currentInput(),x=movement.x,z=movement.z;const actor=actorById(activeActorId),localFirst=Boolean(actor?.local&&isFirstPerson()),remoteFirst=Boolean(!actor?.local&&actor?.firstPerson);
    const l=Math.hypot(x,z),contractSpeed=state.stats.bloodContract&&state.stats.hp<state.stats.maxHp*.5?1.12:1,moveBuff=speedBuffMultiplier()*contractSpeed;player.moving=l>0;if(l>0){x/=Math.max(1,l);z/=Math.max(1,l);moveWithObstacles(player,x*state.stats.speed*moveBuff*dt,z*state.stats.speed*moveBuff*dt,.52);player.moveDir=Math.atan2(z,x);}ensureMapObstacles(player.x,player.z);
    player.stationaryTime=player.moving?0:Math.min(10,(player.stationaryTime||0)+dt);player.inertiaCharge=clamp((player.inertiaCharge||0)+(player.moving?dt/1.2:-dt/1.5),0,1);
    if(localFirst)player.dir=cameraYaw;else if(remoteFirst)player.dir=actor.aimYaw;else if(player.moving)player.dir=player.moveDir;
    if(state.hardcore){state.stats.maxHp=1;state.stats.hp=Math.min(1,state.stats.hp);}
    state.invuln=Math.max(0,state.invuln-dt);state.stats.teleportCooldown=Math.max(0,(state.stats.teleportCooldown||0)-dt);state.stats.thermoHealClock=Math.max(0,(state.stats.thermoHealClock||0)-dt);state.stats.lifestealWindowClock=(state.stats.lifestealWindowClock??1)-dt;if(state.stats.lifestealWindowClock<=0){state.stats.lifestealWindow=0;state.stats.lifestealWindowClock+=1;}state.stats.feedbackWindowClock=(state.stats.feedbackWindowClock??1)-dt;if(state.stats.feedbackWindowClock<=0){state.stats.feedbackCutUsed=0;state.stats.feedbackWindowClock+=1;}if(state.stats.cleanupTimer>0){state.stats.cleanupTimer-=dt;if(state.stats.cleanupTimer<=0)state.stats.cleanupStacks=0;}const pursuit=enemies.find(e=>e.nid===state.stats.pursuitTarget&&!e.dead);if(pursuit)state.stats.pursuitTime=Math.min(10,(state.stats.pursuitTime||0)+dt);else{state.stats.pursuitTarget=0;state.stats.pursuitTime=0;}if(state.stats.regen>0)healPlayer(state.stats.regen*dt);if(TELEMETRY_ENABLED){state.stats.dpsClock=(state.stats.dpsClock??1)-dt;if(state.stats.dpsClock<=0){const bucket=state.stats.recentDamage||{},history=state.stats.damageHistory||[];state.stats.lastDps=state.stats.dpsWindow||0;state.stats.bestDps=Math.max(state.stats.bestDps||0,state.stats.lastDps);history.push(bucket);while(history.length>10)history.shift();const recent={};for(const second of history)for(const [source,damage] of Object.entries(second))recent[source]=(recent[source]||0)+damage;const seconds=Math.max(1,history.length);for(const source of Object.keys(recent))recent[source]/=seconds;state.stats.damageHistory=history;state.stats.recentDamage={};state.stats.recentDpsBySource=recent;state.stats.recentDpsTotal=Object.values(recent).reduce((sum,damage)=>sum+damage,0);state.stats.dpsWindow=0;state.stats.dpsClock+=1;}}
    for(const id of Object.keys(state.buffs))state.buffs[id]=Math.max(0,state.buffs[id]-dt);
    if(state.stats.shield<state.stats.shieldMax){state.stats.shieldClock-=dt;if(state.stats.shieldClock<=0){state.stats.shield++;state.stats.shieldClock=8;toast(`<b>ЩИТ ВОССТАНОВЛЕН</b> · ${state.stats.shield}/${state.stats.shieldMax}`,'#38f3ff');}}
  }
  function update(dt) {
    state.time+=dt;if(state.time>=runDuration()&&!state.endless){state.time=runDuration();endGame(true);return;}
    updateThreat();updateLateScale();updateAdaptiveScaling(dt);updateMilestones();updateEndless();updateHordes(dt);
    rebuildEnemySpatialGrid();
    for(const actor of liveActors())withActor(actor,()=>{updatePlayer(dt,actor.local?null:actor.input);updateWeapons(dt);updateHeroMechanics(dt)});
    updateHeroUnits(dt);updateProjectiles(dt);updateEnemyProjectiles(dt);updateZones(dt);updateEnemies(dt);updateGems(dt);updateConsumables(dt);updateWorldTotems(dt);updateParticles(dt);updateCombatTexts(dt);if(TELEMETRY_ENABLED)updateBalanceTelemetry(dt);
    if(isCoopHost()){const guest=actorById('p2');if(guest?.lastInput&&performance.now()-guest.lastInput>650)guest.input={x:0,z:0};coopNet.snapshotClock-=dt;if(coopNet.snapshotClock<=0){sendSnapshot();const pressure=enemies.length+projectiles.length*.65+zones.length*.8+gems.length*.12;coopNet.snapshotClock=pressure>850?.22:pressure>600?.18:pressure>350?.145:.11;}}
    uiTick-=dt;uiSlowTick-=dt;if(uiTick<=0){const refreshSlow=uiSlowTick<=0;updateUI(refreshSlow);uiTick=.05;if(refreshSlow)uiSlowTick=.2;}
  }

  // ---------- Rendering ----------
  function render(time) {
    resize();for(const k in batches)batches[k].length=0;
    const menu=state.mode==='menu',rtx=rtxEnabled(),threeArena=ensureThreeArenaRenderer(),threeArenaActive=Boolean(threeArena),focus=menu?{x:0,z:0}:player,firstPerson=!menu&&isFirstPerson(),theme=arenaTheme(menu?0:state.time),dominantTheme=ARENA_THEMES[theme.mix>.5?theme.nextIndex:theme.index];
    if(!threeArenaActive){canvas.dataset.threeArena='inactive';canvas.dataset.threeRenderer='fallback';canvas.dataset.threeVersion=window.THREE?.REVISION||'';}
    if(document.body.dataset.arenaTheme!==dominantTheme.id){document.body.dataset.arenaTheme=dominantTheme.id;canvas.dataset.arenaTheme=dominantTheme.id;canvas.dataset.arenaThemeName=dominantTheme.name;const zoneName=$('#arenaZoneName'),zoneHud=$('#arenaZoneHud');if(zoneName)zoneName.textContent=dominantTheme.name;if(zoneHud){zoneHud.dataset.zone=dominantTheme.id;zoneHud.classList.remove('changed');requestAnimationFrame(()=>zoneHud.classList.add('changed'));}}
    canvas.dataset.hero=menu?selectedHero:(state.hero||'vanguard');canvas.dataset.weaponLimit=String(menu?(HEROES[selectedHero]?.weaponSlots||WEAPON_SLOT_LIMIT):currentWeaponSlotLimit());canvas.dataset.heroUnits=String(heroUnits.length);canvas.dataset.heroActivations=String(state.stats?.heroActivations||0);canvas.dataset.mimicCopied=state.stats?.mimicCopied||'';canvas.dataset.adaptiveHealth=String(state.adaptive?.health||1);canvas.dataset.adaptiveTargetHealth=String(state.adaptive?.targetHealth||1);canvas.dataset.adaptiveDamage=String(state.adaptive?.damage||1);canvas.dataset.adaptiveSpeed=String(state.adaptive?.speed||1);canvas.dataset.expectedLevel=String(state.adaptive?.expectedLevel||1);canvas.dataset.adaptivePressure=String(state.adaptive?.pressure||0);canvas.dataset.adaptiveDominant=String(Boolean(state.adaptive?.dominant));
    const camAngle=menu?time*.00007:0,cp=Math.cos(cameraPitch);let eye,lookTarget,fov;
    if(firstPerson){eye=[focus.x+Math.cos(cameraYaw)*.12,1.58,focus.z+Math.sin(cameraYaw)*.12];lookTarget=[eye[0]+Math.cos(cameraYaw)*cp,eye[1]+Math.sin(cameraPitch),eye[2]+Math.sin(cameraYaw)*cp];fov=1.08;}
    else{eye=[focus.x+Math.sin(camAngle)*22,21,focus.z+Math.cos(camAngle)*24];lookTarget=[focus.x,0,focus.z];fov=.82;}
    if(!menu&&shake>0){const amount=(firstPerson?shake*.12:shake)*SCREEN_SHAKE_SCALE;eye[0]+=rand(amount,-amount);eye[1]+=rand(amount*.4,-amount*.4);eye[2]+=rand(amount,-amount);shake=Math.max(0,shake-.055);}
    const view=mat4LookAt(eye,lookTarget);const proj=mat4Perspective(fov,canvas.width/canvas.height,.1,110),vp=mat4Multiply(proj,view);lastViewProjection=vp;lastViewFirstPerson=firstPerson;const frameVisible=collectVisibleFrame(vp,menu),frameEnemies=frameVisible.enemies,frameProjectiles=frameVisible.projectiles,frameEnemyProjectiles=frameVisible.enemyProjectiles,frameGems=frameVisible.gems,frameParticles=frameVisible.particles,frameBeams=frameVisible.beams,frameZones=frameVisible.zones,frameConsumables=frameVisible.consumables,frameTotems=frameVisible.worldTotems,frameHeroUnits=frameVisible.heroUnits,pocketReady=Boolean(threeArenaActive&&threeArena.hasPocketModel?.()),monsterReady=Boolean(threeArenaActive&&threeArena.hasMonsterModel?.());let pocketVisual=null,monsterVisuals=[];const monsterModelNids=new Set();if(monsterReady&&!menu){const candidates=frameEnemies.filter(enemy=>!enemy.boss&&!enemy.miniboss&&!enemy.elite&&BASIC_MONSTER_MODEL_TYPES.has(enemy.type)).map(enemy=>({enemy,distanceSquared:dist2(enemy,focus)})).sort((a,b)=>a.distanceSquared-b.distanceSquared).slice(0,BASIC_MONSTER_MODEL_CAP);monsterVisuals=candidates.map(({enemy,distanceSquared},index)=>{const target=closestActor(enemy)?.entity||player;monsterModelNids.add(enemy.nid);return{x:enemy.x,z:enemy.z,size:enemy.size,dir:Math.atan2(target.z-enemy.z,target.x-enemy.x),animate:index<BASIC_MONSTER_ANIMATED_CAP&&distanceSquared<BASIC_MONSTER_ANIMATION_DISTANCE**2};});}canvas.dataset.culledEnemies=String(Math.max(0,enemies.length-frameEnemies.length));canvas.dataset.culledEffects=String(Math.max(0,projectiles.length+enemyProjectiles.length+zones.length+beams.length+particles.length-frameProjectiles.length-frameEnemyProjectiles.length-frameZones.length-frameBeams.length-frameParticles.length));
    if(!threeArenaActive){
      // Emergency legacy fallback if local Three.js cannot initialize.
      const gx=Math.floor(focus.x/4),gz=Math.floor(focus.z/4);
      for(let x=-10;x<=10;x++)for(let z=-9;z<=9;z++){
        const wx=(gx+x)*4,wz=(gz+z)*4,shade=((gx+x)+(gz+z))%2===0?theme.ground:theme.groundAlt;
        add('cube',wx,-.28,wz,3.94,.5,3.94,0,shade);
      }
      for(let i=0;i<18;i++){
        const{angle:a,x,z,height:h}=arenaPylonPlacement(i);
        add('cube',x,h*.38,z,.8,h*.75,.8,a,COLORS.stone);add('pyramid',x,h*.9,z,1.15,h*.45,1.15,a+(i%2?0:.785),theme.line);add('ring',x,.08,z,2.3,.08,2.3,a,[...theme.accent,.24]);add('octa',x,h*1.18,z,.24,.55,.24,time*.0008+i,(i%3)?[...theme.accent,1]:[...theme.secondary,1]);
      }
      if(!menu&&dominantTheme.id==='forge')for(let i=0;i<10;i++){const a=i/10*TAU+.25,r=25+(i%2)*5,x=focus.x+Math.cos(a)*r,z=focus.z+Math.sin(a)*r;add('cube',x,1.1,z,.7,2.2,.7,a,[.11,.055,.02,1]);add('octa',x,2.45,z,.32,.68,.32,time*.001+i,[...theme.secondary,.9]);}
      if(!menu&&dominantTheme.id==='blight')for(let i=0;i<14;i++){const a=i/14*TAU,r=24+(i%3)*3.5,x=focus.x+Math.cos(a)*r,z=focus.z+Math.sin(a)*r;add('pyramid',x,.65,z,.55,1.35,.55,a+time*.00008,[...theme.accent,.78]);add('octa',x,1.62+Math.sin(time*.001+i)*.18,z,.2,.48,.2,-a,[...theme.secondary,.72]);}
      if(!menu&&dominantTheme.id==='void')for(let i=0;i<12;i++){const a=i/12*TAU-time*.00003,r=23+(i%4)*2.7,x=focus.x+Math.cos(a)*r,z=focus.z+Math.sin(a)*r,y=2.6+(i%3)*1.1+Math.sin(time*.0012+i)*.35;add('octa',x,y,z,.55,1.25,.55,time*.0007+i,[...theme.accent,.56]);add('ring',x,y,z,1.8,.08,1.8,-time*.001,[...theme.secondary,.25]);}
    }

    if(menu){
      add('cylinder',0,.12,0,4.7,.24,4.7,0,[.025,.06,.055,1]);
      add('ring',0,.27,0,5.7,.12,5.7,time*.00018,[.14,.88,.7,.72]);
      add('ring',0,.31,0,3.9,.09,3.9,-time*.00032,[1,.61,.16,.64]);
      if(rtx)add('cylinder',0,.018,0,10,.024,10,0,[.05,.8,.62,.075]);
      const heroColor=HEROES[selectedHero].color;
      if(pocketReady)pocketVisual={x:0,z:0,dir:time*.00035,moving:false,menu:true,visible:true};
      else{add('cylinder',0,.82,0,1.42,1.45,1.42,time*.00035,heroColor);add('ring',0,1.48,0,1.62,.16,1.62,-time*.0011,COLORS.brass);add('octa',0,1.94,0,.6,.72,.6,time*.0017,COLORS.white);add('octa',0,1.95,0,.27,.32,.27,-time*.0024,heroColor);}
      for(let i=0;i<28;i++){
        const a=i/28*TAU+time*.000025*(i%2?1:-1),r=8+(i%6)*.95,x=Math.cos(a)*r,z=Math.sin(a)*r,large=i%9===0;
        add(large?'cube':i%3?'cylinder':'pyramid',x,large?.9:.62,z,large?1.2:.66,large?1.8:1.18,large?1.2:.66,-a,[.42,.025,.075,1]);
        add('octa',x,large?2.05:1.36,z,large?.35:.22,large?.48:.3,large?.35:.22,time*.001+i,COLORS.red);
        add('ring',x,.035,z,large?2.1:1.15,.035,large?2.1:1.15,0,[1,.02,.12,large?.24:.10]);
      }
    } else {
      // Ground shadows.
      const renderActors=coopActors.length?coopActors.filter(actor=>actor.connected&&actor.stats.hp>0):[{entity:player,stats:state.stats,weapons:state.weapons,relics:state.relics,buffs:state.buffs,hero:state.hero,invuln:state.invuln,local:true}],hideActor=actor=>firstPerson&&actor.local;
      const persistentAttackCount=visibleAoeTotal,beamAttackCount=frameBeams.filter(beam=>beam.color!==COLORS.red).length,attachedAttackCount=renderActors.reduce((sum,actor)=>sum+(actor.weapons.orbit?2+Math.floor(actor.weapons.orbit/2)+(actor.relics?.evoOrbit?4:0):0)+(actor.weapons.drone?1+Math.floor(actor.weapons.drone/3):0),0),attackVisualLoad=frameProjectiles.length+persistentAttackCount+beamAttackCount+attachedAttackCount;
      if(playerAttacksFaded?attackVisualLoad<ATTACK_FADE_EXIT:attackVisualLoad>=ATTACK_FADE_ENTER)playerAttacksFaded=!playerAttacksFaded;
      const playerAttackAlpha=playerAttacksFaded?ATTACK_OVERLOAD_ALPHA:1;
      const attackColor=color=>{
        // Crimson is reserved for hostile attacks. Player fire becomes hot gold.
        const hostileLooking=color[0]>(color[1]*1.8)&&color[0]>(color[2]*1.35);
        const visual=hostileLooking?[1,.62,.12,color[3]??1]:color;
        return [visual[0],visual[1],visual[2],(visual[3]??1)*playerAttackAlpha];
      };
      canvas.dataset.attackLoad=String(attackVisualLoad);canvas.dataset.attackOpacity=String(playerAttackAlpha);canvas.dataset.aoeTotal=String(visibleAoeTotal);canvas.dataset.aoeRendered=String(Math.max(0,visibleAoeTotal-visibleAoeCulled));canvas.dataset.aoeCulled=String(visibleAoeCulled);canvas.dataset.aoeCulling=aoeVisualCulling?'active':'off';
      let visibleObstacles=0;const obstacleColors=[theme.groundAlt,theme.ground,[theme.groundAlt[0]*1.18,theme.groundAlt[1]*1.18,theme.groundAlt[2]*1.18,1]];for(const obstacle of nearbyObstacles(focus.x,focus.z,48)){if((obstacle.x-focus.x)**2+(obstacle.z-focus.z)**2>48**2)continue;visibleObstacles++;const color=obstacleColors[obstacle.variant%obstacleColors.length],w=obstacle.hx*2,d=obstacle.hz*2,h=obstacle.height;
        add('cube',obstacle.x,h*.5,obstacle.z,w,h,d,0,color);
        add('cube',obstacle.x,h+.045,obstacle.z,w*1.035,.09,d*1.035,0,[...theme.accent,.8]);
        add('cube',obstacle.x,h*.24,obstacle.z,w*1.025,.075,d*1.025,0,[...theme.secondary,.72]);
        add('cube',obstacle.x,h*.66,obstacle.z,w*1.02,.045,d*1.02,0,[...theme.accent,.52]);
        add('ring',obstacle.x,.035,obstacle.z,Math.max(w,d)*1.2,.055,Math.max(w,d)*1.2,0,[...theme.accent,.24]);
        add('cylinder',obstacle.x,.02,obstacle.z,w*1.1,.03,d*1.1,0,COLORS.shadow);
        if(rtx)add('cube',obstacle.x+.32,.018,obstacle.z+.24,w*1.18,.025,d*1.18,-.05,[0,0,.012,.28]);
      }canvas.dataset.visibleObstacles=String(visibleObstacles);
      for(const actor of renderActors)if(!hideActor(actor))add('cylinder',actor.entity.x,.03,actor.entity.z,1.35,.04,1.35,0,COLORS.shadow);
      for(const e of frameEnemies)add('cylinder',e.x,.025,e.z,e.size*1.5,.035,e.size*1.5,0,COLORS.shadow);
      if(rtx){
        for(const actor of renderActors)if(!hideActor(actor)){add('cylinder',actor.entity.x+.38,.018,actor.entity.z+.28,1.8,.025,1.8,-.25,[0,0,.012,.2]);add('cylinder',actor.entity.x,.012,actor.entity.z,7,.018,7,0,[.04,.58,.86,.055]);}
        for(const e of frameEnemies){add('cylinder',e.x+.32*e.size,.016,e.z+.24*e.size,e.size*2,.022,e.size*1.65,-.28,[0,0,.012,.18]);if(e.boss||e.miniboss)add('cylinder',e.x,.014,e.z,e.size*3.5,.02,e.size*3.5,0,[1,.04,.28,.075]);}
      }
      // Hero: armored silhouette, luminous heart, brass halo and forward visor.
      for(const actor of renderActors){if(hideActor(actor))continue;const body=actor.entity,hc=HEROES[actor.hero]?.color||COLORS.cyan,blink=actor.invuln>0&&Math.floor(actor.invuln*20)%2===0;
        const usePocket=pocketReady&&actor.local;if(usePocket)pocketVisual={x:body.x,z:body.z,dir:body.dir||0,moving:Boolean(body.moving),menu:false,visible:!blink};
        if(!blink&&!usePocket){
          add('cylinder',body.x,.69,body.z,.98,1.28,.98,body.dir||0,[hc[0]*.52,hc[1]*.52,hc[2]*.52,1]);
          add('ring',body.x,1.12,body.z,1.12,.14,1.12,-time*.0022,COLORS.brass);
          add('octa',body.x,1.48,body.z,.61,.68,.61,time*.002,hc);
          add('octa',body.x,1.49,body.z,.28,.31,.28,-time*.0032,COLORS.white);
          const dir=body.dir||0,sideX=Math.cos(dir+Math.PI/2),sideZ=Math.sin(dir+Math.PI/2);
          add('octa',body.x+sideX*.55,1.06,body.z+sideZ*.55,.24,.34,.24,dir,COLORS.brass);
          add('octa',body.x-sideX*.55,1.06,body.z-sideZ*.55,.24,.34,.24,dir,COLORS.brass);
          add('cube',body.x+Math.cos(dir)*.62,1.45,body.z+Math.sin(dir)*.62,.46,.14,.18,-dir,COLORS.cyan);
        }
        if(actor.buffs.immortal>0||actor.stats.shield>0){const shieldColor=actor.buffs.immortal>0?[1,.75,.2,.32]:[.2,1,.84,.23];add('ring',body.x,.62,body.z,1.95,1.22,1.95,time*.002,shieldColor);add('ring',body.x,.62,body.z,1.95,1.22,1.95,-time*.0028,shieldColor);}
      }
      for(const unit of frameHeroUnits){const owner=actorById(unit.owner),fade=clamp(unit.life/2,0,1);if(unit.kind==='turret'){add('cylinder',unit.x,.35,unit.z,.72,.65,.72,unit.seed,[1,.48,.06,fade]);add('cube',unit.x,.9,unit.z,.32,.32,1.15,-unit.seed,[1,.82,.28,fade]);add('octa',unit.x,1.25,unit.z,.22,.22,.22,time*.004,COLORS.white);}else{const a=owner?Math.atan2(owner.entity.z-unit.z,owner.entity.x-unit.x):0;add('octa',unit.x,.62,unit.z,.52,.82,.52,-a,[.48,.16,1,fade]);add('cylinder',unit.x,.12,unit.z,.7,.16,.7,time*.003,[.16,.9,.72,fade*.55]);}}
      // Enemies.
      const localTargetNid=(localCombatActor()?.entity||player).lockedTargetNid||0;
      let enemyLodNear=0,enemyLodMid=0,enemyLodFar=0;
      for(const e of frameEnemies){const visualTarget=closestActor(e)?.entity||player,c=e.hit?COLORS.white:e.color,y=e.size*.7+Math.sin(time*.004+e.seed)*.05,a=Math.atan2(visualTarget.z-e.z,visualTarget.x-e.x),shape=e.type==='runner'||e.type==='charger'||e.type==='burrower'?'pyramid':e.type==='shooter'||e.type==='absorber'?'cube':e.type==='splitter'||e.type==='phaser'?'octa':'cylinder',distanceSquared=dist2(e,focus),near=distanceSquared<18**2,medium=distanceSquared<32**2,important=e.boss||e.miniboss||e.elite||e.nid===localTargetNid||e.type==='standard'||e.type==='absorber',modelEnemy=monsterModelNids.has(e.nid);
        if(near)enemyLodNear++;else if(medium)enemyLodMid++;else enemyLodFar++;
        if(e.nid===localTargetNid){const pulse=1+Math.sin(time*.012)*.1,r=e.size*2.18+.58;add('ring',e.x,.075,e.z,r*pulse,.065,r*pulse,time*.002,COLORS.cyan);add('ring',e.x,.09,e.z,r*.72,.055,r*.72,-time*.003,COLORS.green);add('octa',e.x,y+e.size*2.35,e.z,.3*pulse,.48*pulse,.3*pulse,time*.004,COLORS.cyan);}
        if(e.burrowWindup>0){add('octa',e.x,.06,e.z,e.size*.42,.12,e.size*.42,time*.004,COLORS.red);continue;}
        if(e.boss||e.miniboss){
          add('cylinder',e.x,y*.84,e.z,e.size*1.16,e.size*1.28,e.size*1.16,a,[c[0]*.56,c[1]*.48,c[2]*.52,1]);
          add('ring',e.x,y+e.size*.43,e.z,e.size*1.42,e.size*.14,e.size*1.42,-time*.0018,COLORS.brass);
          add('pyramid',e.x,y+e.size*1.15,e.z,e.size*.86,e.size*.95,e.size*.86,a+Math.PI*.25,c);
          add('octa',e.x,y+e.size*1.62,e.z,e.size*.36,e.size*.52,e.size*.36,time*.0022,COLORS.red);
          for(let s=-1;s<=1;s+=2)add('pyramid',e.x+Math.cos(a+Math.PI/2)*e.size*.82*s,y+e.size*.55,e.z+Math.sin(a+Math.PI/2)*e.size*.82*s,e.size*.34,e.size*.9,e.size*.34,a,COLORS.brass);
          add('ring',e.x,.07,e.z,e.size*3.15,.055,e.size*3.15,time*.0007,[1,.04,.16,.36]);
        }else if(modelEnemy){
          if(e.hit)add('ring',e.x,y+e.size*.42,e.z,e.size*1.1,e.size*.13,e.size*1.1,a,[1,1,1,.46]);
        }else{
          add(shape,e.x,y,e.z,e.size,e.size*1.45,e.size,a,c);
          if(medium||important)add('ring',e.x,y+e.size*.28,e.z,e.size*1.08,e.size*.11,e.size*1.08,a,[.48,.20,.12,1]);
          if(medium||important)add('octa',e.x,y+e.size*.78,e.z,e.size*.34,e.size*.42,e.size*.34,time*.0015+e.seed,e.elite?e.affixColor:COLORS.red);
        }
        if(near&&!e.boss&&!e.miniboss&&!modelEnemy){const side=a+Math.PI/2;add('pyramid',e.x+Math.cos(side)*e.size*.58,y+.03,e.z+Math.sin(side)*e.size*.58,e.size*.22,e.size*.52,e.size*.22,a,COLORS.stone);add('pyramid',e.x-Math.cos(side)*e.size*.58,y+.03,e.z-Math.sin(side)*e.size*.58,e.size*.22,e.size*.52,e.size*.22,a,COLORS.stone);}
        if(e.type==='shooter'&&(medium||important)){add('cube',e.x+Math.cos(a)*e.size*.9,y+.18,e.z+Math.sin(a)*e.size*.9,e.size*.32,.22,e.size*1.45,-a,COLORS.red);add('ring',e.x,y+.42,e.z,e.size*1.35,.12,e.size*1.35,time*.002,[1,.03,.16,.4]);}
        if(e.type==='warden'&&e.shieldHits>0&&(medium||important))add('cube',e.x+Math.cos(a)*e.size*.7,y,e.z+Math.sin(a)*e.size*.7,e.size*1.45,e.size*1.5,.18,-a,[.3,.72,1,.72]);
        if(e.type==='splitter'&&near){add('octa',e.x-e.size*.55,y+.2,e.z,e.size*.35,e.size*.55,e.size*.35,-a,COLORS.pink);add('octa',e.x+e.size*.55,y+.2,e.z,e.size*.35,e.size*.55,e.size*.35,a,COLORS.pink);}
        if(e.type==='phaser'&&dist2(e,visualTarget)>5.5**2)add('cylinder',e.x,y*.72,e.z,e.size*1.55,e.size*1.18,e.size*1.55,time*.003,[.58,.24,1,.34]);
        if(e.type==='standard'){add('cube',e.x,y+1.15,e.z,.16,2.45,.16,0,COLORS.amber);add('pyramid',e.x,y+2.25,e.z,.72,.82,.18,a,COLORS.red);add('cylinder',e.x,.045,e.z,8.2,.025,8.2,0,[1,.55,.06,.13]);}
        if(e.type==='absorber'&&e.absorbActive)add('cube',e.x+Math.cos(a)*e.size*.82,y,e.z+Math.sin(a)*e.size*.82,e.size*1.7,e.size*1.7,.16,-a,[.2,.82,1,.72]);
        if(e.elite&&(medium||near)){add('ring',e.x,.055,e.z,e.size*1.95,.055,e.size*1.95,time*.001,[...e.affixColor.slice(0,3),.62]);if(near)add('ring',e.x,y+.35,e.z,e.size*1.38,.09,e.size*1.38,-time*.0018,[...e.affixColor.slice(0,3),.55]);}
        if(e.chargeWindup>0)add('ring',e.x,.06,e.z,e.size*(2.2+e.chargeWindup*2),.06,e.size*(2.2+e.chargeWindup*2),0,[1,.03,.16,.72]);
        if(e.bossDashWindup>0)add('ring',e.x,.065,e.z,e.size*(2.4+e.bossDashWindup*2),.07,e.size*(2.4+e.bossDashWindup*2),0,[1,.02,.14,.82]);
      }
      canvas.dataset.enemyLodNear=String(enemyLodNear);canvas.dataset.enemyLodMid=String(enemyLodMid);canvas.dataset.enemyLodFar=String(enemyLodFar);
      // Projectiles, XP and temporary consumables.
      // Three.js uses shader-only two-triangle projectile cards; these primitives are only an emergency fallback.
      if(!threeArenaActive)for(const p of frameProjectiles){const a=Math.atan2(p.vz,p.vx),color=attackColor(p.color||COLORS.cyan),size=Math.max(.06,p.size||.14);if(p.kind==='saw'||p.kind==='boomerang'){add('cylinder',p.x,p.y||.8,p.z,size*1.45,.08,size*1.45,p.spin||time*.01,color);add('ring',p.x,p.y||.8,p.z,size*1.85,.05,size*1.85,p.spin||time*.01,[...color.slice(0,3),.46]);}else{add('octa',p.x,p.y||.8,p.z,size,size,size*1.8,-a,color);add('cube',p.x-Math.cos(a)*size*1.8,p.y||.8,p.z-Math.sin(a)*size*1.8,size*.34,size*.34,size*3,-a,[...color.slice(0,3),.28]);}}
      for(const p of frameEnemyProjectiles){const a=Math.atan2(p.vz,p.vx);add('octa',p.x,p.y,p.z,p.size,p.size,p.size*1.7,-a+p.spin*.08,COLORS.red);add('cube',p.x-Math.cos(a)*.38,p.y,p.z-Math.sin(a)*.38,.11,.11,.72,-a,[1,.02,.12,.55]);add('ring',p.x,.04,p.z,p.size*3.4,.035,p.size*3.4,time*.003,[1,.01,.1,.28]);if(rtx)add('cylinder',p.x,.022,p.z,p.size*3.8,.022,p.size*3.8,0,[1,.015,.12,.18]);}
      for(const g of frameGems){const bob=.38+Math.sin(time*.006+g.x)*.12;add('octa',g.x,bob,g.z,.22,.34,.22,time*.002,g.color);if(rtx)add('cylinder',g.x,.018,g.z,.62,.018,.62,0,[...g.color.slice(0,3),.1]);}
      for(const c of frameConsumables){const info=CONSUMABLES[c.type],bob=.7+Math.sin(time*.007+c.seed)*.18;add('cube',c.x,bob,c.z,.58,.58,.58,time*.0025+c.seed,info.rgb);add('octa',c.x,bob+1,c.z,.15,.8,.15,time*.003,[...info.rgb.slice(0,3),.45]);if(rtx)add('cylinder',c.x,.018,c.z,1.6,.02,1.6,0,[...info.rgb.slice(0,3),.12]);}
      // Optional risk totems sit in the world until touched.
      for(const t of frameTotems){const pulse=.9+Math.sin(time*.006+t.seed)*.09;add('cylinder',t.x,.35,t.z,1.45,.45,1.45,time*.0007,[.24,.025,.06,1]);add('ring',t.x,.6,t.z,1.72,.13,1.72,-time*.0012,COLORS.brass);add('pyramid',t.x,1.55,t.z,1.1,2.5,1.1,time*.0012+t.seed,COLORS.red);add('octa',t.x,3.05,t.z,.42*pulse,.72*pulse,.42*pulse,-time*.002,COLORS.amber);add('ring',t.x,.065,t.z,3.4,.055,3.4,time*.001,[1,.03,.14,.38]);}
      // Orbitals are rendered from their deterministic attack positions.
      for(const actor of renderActors){const body=actor.entity,ol=actor.weapons.orbit;if(ol){const evolved=Boolean(actor.relics?.evoOrbit),count=2+Math.floor(ol/2)+(evolved?3:0),r=(2.15+ol*.12)*(evolved?1.15:1),now=state.time*(1.7+ol*.09)*(evolved?1.18:1);for(let i=0;i<count;i++){const a=now+i/count*TAU;add('pyramid',body.x+Math.cos(a)*r,.8,body.z+Math.sin(a)*r,.42*actor.stats.projSize*(evolved?1.2:1),1.2,.42*actor.stats.projSize*(evolved?1.2:1),-a,attackColor(evolved?COLORS.green:COLORS.amber));}}
        const dl=actor.weapons.drone;if(dl){const count=1+Math.floor(dl/3)+(actor.hero==='engineer'?1:0),now=state.time*2.2;for(let i=0;i<count;i++){const a=now+i/count*TAU,x=body.x+Math.cos(a)*1.7,z=body.z+Math.sin(a)*1.7;add('octa',x,1.35,z,.38,.3,.5,-a,attackColor(COLORS.amber));add('cube',x,1.35,z,.16,.16,.75,-a,attackColor(COLORS.white));}}
        const ml=actor.weapons.mirrordisc;if(ml){const dir=body.dir||0,x=body.x+Math.cos(dir)*1.25,z=body.z+Math.sin(dir)*1.25,size=.62+ml*.025;add('cylinder',x,.82,z,size,.1,size,state.time*4,attackColor(actor.relics?.evoMirrorDisc?COLORS.white:COLORS.cyan));add('octa',x,1.02,z,size*.34,size*.34,size*.34,-state.time*3,attackColor(COLORS.white));}}
      // Pulses, warnings, blasts.
      for(const z of frameZones){const friendly=!String(z.kind).startsWith('enemy');if(friendly&&threeArenaActive)continue;const zoneAlpha=friendly?playerAttackAlpha:1,visualColor=friendly?attackColor(z.color||COLORS.cyan):COLORS.red;let scale=1,alpha=.6;if(z.kind==='meteor'||z.kind==='mortar'){scale=1;alpha=.28+Math.sin(z.life*28)*.18;add('octa',z.x,8*z.life/z.max,z.z,z.kind==='mortar'?.48:.65,z.kind==='mortar'?1:1.3,z.kind==='mortar'?.48:.65,time*.003,visualColor);}else if(z.kind==='gravity'){scale=.88+Math.sin(time*.01)*.08;alpha=.48;add('octa',z.x,.72,z.z,.7,.9,.7,time*.004,friendly?attackColor(COLORS.violet):COLORS.red);add('ring',z.x,.18,z.z,z.radius*.6,.18,z.radius*.6,-time*.003,visualColor);}else if(z.kind==='firetrail'){scale=Math.min(1,(z.max-z.life)*5);alpha=.5*Math.min(1,z.life*1.2);add('pyramid',z.x,.28,z.z,.32,.7+.18*Math.sin(time*.014+z.x),.32,time*.003,visualColor);}else if(z.kind==='storm'){scale=.92+Math.sin(time*.018+z.x)*.08;alpha=.42;add('octa',z.x,.9,z.z,.35,.9,.35,time*.01,friendly?attackColor(COLORS.cyan):COLORS.red);}else if(z.kind==='riftScar'){scale=.82;alpha=.34;add('pyramid',z.x,.36,z.z,.38,.85,.38,time*.003,friendly?attackColor(COLORS.violet):COLORS.red);}else if(z.kind==='mine'){scale=.82+Math.sin(time*.008+(z.seed||0))*.07;alpha=.24;add('octa',z.x,.24,z.z,.42,.22,.42,time*.003,visualColor);}else if(z.kind==='seismic'){scale=clamp(1-z.life/z.max,0,1);alpha=.72;}else if(z.kind==='enemyWarning'||z.kind==='enemyTrap'){scale=.82+Math.sin(time*.018)*.08;alpha=.68;}else if(z.kind==='enemyBlast'){scale=1-z.life/z.max;alpha=.78;}else scale=1-z.life/z.max;
        const col=[visualColor[0],visualColor[1],visualColor[2],alpha*(z.life/z.max+.1)*zoneAlpha];
        add('ring',z.x,.065,z.z,z.radius*scale,.07,z.radius*scale,time*.0007,col);
        add('cylinder',z.x,.035,z.z,z.radius*scale*.86,.025,z.radius*scale*.86,0,[col[0],col[1],col[2],col[3]*(friendly?.17:.23)]);
        if(rtx)add('ring',z.x,.03,z.z,z.radius*scale*1.22,.035,z.radius*scale*1.22,-time*.0005,[col[0],col[1],col[2],col[3]*.28]);
      }
      for(const b of frameBeams){if(threeArenaActive&&b.color!==COLORS.red)continue;const dx=b.x2-b.x1,dz=b.z2-b.z1,len=Math.hypot(dx,dz),a=Math.atan2(-dz,dx),f=b.life/b.max,beamAlpha=b.color===COLORS.red?1:playerAttackAlpha;add('cube',(b.x1+b.x2)/2,1,(b.z1+b.z2)/2,len,.11,.11,a,[...b.color.slice(0,3),f*beamAlpha]);if(rtx)add('cube',(b.x1+b.x2)/2,1,(b.z1+b.z2)/2,len,.28,.28,a,[...b.color.slice(0,3),f*.12*beamAlpha]);}
      for(const p of frameParticles){const f=p.life/p.max;add('octa',p.x,p.y,p.z,p.size*f,p.size*f,p.size*f,0,[...p.color.slice(0,3),f]);if(rtx)add('octa',p.x,p.y,p.z,p.size*f*1.7,p.size*f*1.7,p.size*f*1.7,0,[...p.color.slice(0,3),f*.1]);}
    }

    const fog=theme.fog.map(value=>rtx?value*.72:value*1.18);
    const graphicsRendererStatus=$('#graphicsRendererStatus');
    if(threeArenaActive){threeArena.render({time,eye,lookTarget,fov,focus,theme,rtx,batches,weaponFx:frameVisible,pocketVisual,monsterVisuals});if(graphicsRendererStatus){graphicsRendererStatus.textContent=rtx?'THREE · RTX · VSM 512 · SHADER FX':'THREE · NORMAL · SHADER FX · BLOOM';graphicsRendererStatus.classList.toggle('rtx',rtx);graphicsRendererStatus.classList.remove('fallback');}}
    else{
      if(graphicsRendererStatus){graphicsRendererStatus.textContent='LEGACY FALLBACK · ЭФФЕКТЫ ОТКЛЮЧЕНЫ';graphicsRendererStatus.classList.remove('rtx');graphicsRendererStatus.classList.add('fallback');graphicsRendererStatus.title=canvas.dataset.threeError||'Three.js не инициализирован';}
      gl.clearColor(fog[0],fog[1],fog[2],1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.frontFace(gl.CCW);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);gl.uniformMatrix4fv(uVP,false,vp);gl.uniform3fv(uCamera,eye);gl.uniform3f(uFogColor,fog[0],fog[1],fog[2]);gl.uniform3f(uPlayerLight,focus.x,rtx?3.4:1,focus.z);gl.uniform3fv(uArenaAccent,theme.accent);gl.uniform3fv(uArenaSecondary,theme.secondary);gl.uniform1f(uRtx,rtx?1:0);gl.uniform1f(uTime,time*.001);meshes.cube.draw(batches.cube);meshes.cylinder.draw(batches.cylinder);meshes.pyramid.draw(batches.pyramid);meshes.octa.draw(batches.octa);meshes.ring.draw(batches.ring);
    }
    renderCombatTexts();
  }

  function loop(now) {
    const dt=Math.min(.05,(now-last)/1000||0);last=now;ambientTime+=dt;
    if(state.mode==='playing')update(dt);else if(state.mode==='remote')updateGuest(dt);else if(state.mode==='menu')player={x:0,z:0,y:0};
    render(now);requestAnimationFrame(loop);
  }

  // ---------- Input ----------
  const customModal=$('#customDifficultyModal');
  function syncDifficultyButtons(){ $$('.difficulty-option').forEach(option=>option.classList.toggle('selected',option.dataset.difficulty===selectedDifficulty)); }
  function selectDifficulty(mode,sound=true){selectedDifficulty=['normal','hardcore','custom'].includes(mode)?mode:'normal';syncDifficultyButtons();syncMenuSummary();if(sound){audio.init();audio.tone(selectedDifficulty==='hardcore'?115:selectedDifficulty==='custom'?570:330,.1,'triangle',.025);}}
  function renderCustomForm(settings){
    const clean=sanitizeCustomSettings(settings);
    $$('[data-custom]').forEach(input=>{const key=input.dataset.custom;input.value=key==='bossCopies'?clean[key]:Math.round(clean[key]*100);});
    updateCustomOutputs();
  }
  function updateCustomOutputs(){ $$('[data-custom]').forEach(input=>{const key=input.dataset.custom,output=$(`[data-output="${key}"]`);output.textContent=key==='bossCopies'?`×${input.value}`:`${input.value}%`;}); }
  function readCustomForm(){const raw={};$$('[data-custom]').forEach(input=>{const key=input.dataset.custom;raw[key]=key==='bossCopies'?Number(input.value):Number(input.value)/100;});return sanitizeCustomSettings(raw);}
  function openCustomDifficulty(){renderCustomForm(customSettings);customModal.classList.remove('hidden');setTimeout(()=>customModal.querySelector('input')?.focus(),0);audio.init();audio.tone(510,.12,'triangle',.025);}
  function closeCustomDifficulty(){customModal.classList.add('hidden');}
  function applyCustomDifficulty(){customSettings=readCustomForm();try{localStorage.setItem('riftCustomDifficulty',JSON.stringify(customSettings));}catch(_error){}selectDifficulty('custom');closeCustomDifficulty();toast('<b>КАСТОМНАЯ СЛОЖНОСТЬ</b> сохранена для следующего забега','#ffbd3d');}
  $$('[data-custom]').forEach(input=>input.addEventListener('input',updateCustomOutputs));
  $('#customResetBtn').addEventListener('click',()=>{renderCustomForm(CUSTOM_DEFAULTS);audio.init();audio.tone(260,.08,'triangle',.02);});
  $('#customCancelBtn').addEventListener('click',closeCustomDifficulty);$('#customCloseBtn').addEventListener('click',closeCustomDifficulty);$('#customApplyBtn').addEventListener('click',applyCustomDifficulty);
  customModal.addEventListener('click',e=>{if(e.target===customModal)closeCustomDifficulty();});

  // ---------- Rift codex ----------
  const codexModal=$('#codexModal'),codexList=$('#codexList'),codexDetail=$('#codexDetail'),codexSearch=$('#codexSearch');
  let codexTab='weapons',codexSelectedId='',codexReturnFocus=null;
  const codexEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function codexEntries(tab=codexTab){
    if(tab==='heroes')return Object.entries(CODEX_HEROES).map(([id,data])=>({id,name:HEROES[id].name,type:'ГЕРОЙ',max:1,...data,codexColor:data.color}));
    if(tab==='weapons')return upgrades.filter(item=>item.type==='ОРУЖИЕ');
    if(tab==='items')return [...upgrades.filter(item=>item.type!=='ОРУЖИЕ'),...bossRelics,...riftResonanceUpgrades];
    return evolutionUpgrades;
  }
  function codexDescription(item){try{return item.desc?.()||''}catch(_error){return ''}}
  function codexRarity(item){return item.type==='ГЕРОЙ'?{label:item.role||'ГЕРОЙ',color:item.codexColor||'#38f3ff'}:rarityStyle[item.rarity]||rarityStyle.common}
  function codexRequiredItem(evolution){return upgrades.find(item=>item.id===evolution.requires)}
  function codexWeaponItem(id){return upgrades.find(item=>item.id===id&&item.type==='ОРУЖИЕ')}
  const codexNumber=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2});
  const codexMultiplier=value=>`×${codexNumber(value)}`;
  function codexHeroStats(item){
    const hero=HEROES[item.id],starter=hero.randomStarter?'Случайное из 20 оружий':hero.starter?`${WEAPON_INFO[hero.starter]?.name||hero.starter} · уровень 1`:'Собственная автоатака · слот не занимает';
    return [['Стартовое оружие',starter],['Здоровье',`${hero.maxHp} HP`],['Глобальный урон',codexMultiplier(hero.damage*HERO_BASE_DAMAGE_MULTIPLIER)],['Скорость движения',codexNumber(hero.speed)],['Броня',String(hero.armor)],['Шанс крита',`${Math.round(hero.crit*100)}%`],['Множитель крита','×2'],['Базовые снаряды','1'],['Базовое пробитие',String(hero.pierce)],['Темп атак',codexMultiplier(hero.fireRate||1)],['Размер атак','×1'],['Скорость снарядов',codexMultiplier(hero.projSpeed||1)],['Длительность эффектов',codexMultiplier(hero.duration||1)],['Радиус сбора','4'],['Слоты билда',`${hero.weaponSlots||WEAPON_SLOT_LIMIT} оружий · ${ITEM_SLOT_LIMIT} предметов`]];
  }
  function codexSearchText(item,tab){
    const weapon=CODEX_WEAPONS[item.id],evolutionStats=CODEX_EVOLUTION_STATS[item.id]||[],required=tab==='evolutions'?codexRequiredItem(item):null,base=tab==='evolutions'?codexWeaponItem(item.weapon):null,impacts=CODEX_ITEM_IMPACTS[item.id]||[];
    return [item.name,item.type,codexRarity(item).label,item.summary,codexDescription(item),...(item.abilities||[]).flat(),...(item.tags||[]),...(item.preview||[]).flat(),...(tab==='heroes'?codexHeroStats(item).flat():[]),weapon?.summary,...(weapon?.stats||[]).flat(),...(weapon?.impacts||[]),...evolutionStats,...impacts,CODEX_ITEM_NOTES[item.id],required?.name,base?.name].filter(Boolean).join(' ').toLocaleLowerCase('ru');
  }
  function codexLink(tab,id,icon,name,caption){return `<button class="codex-link" type="button" data-codex-open-tab="${tab}" data-codex-open-id="${id}"><span>${codexEsc(icon)}</span><span><b>${codexEsc(name)}</b><small>${codexEsc(caption)}</small></span><i>→</i></button>`}
  function codexHero(item,lead){
    const rarity=codexRarity(item);
    return `<div class="codex-detail-hero"><div class="codex-detail-icon">${codexEsc(item.icon)}</div><div><span class="codex-detail-kicker">${codexEsc(rarity.label)} · ${codexEsc(item.type)}</span><h3>${codexEsc(item.name)}</h3><p class="codex-detail-lead">${codexEsc(lead)}</p></div></div>`;
  }
  function codexStats(stats){return `<div class="codex-stat-grid">${stats.map(([label,value])=>`<div class="codex-stat"><span>${codexEsc(label)}</span><b>${codexEsc(value)}</b></div>`).join('')}</div>`}
  function codexTags(tags){return `<div class="codex-tags">${tags.map(tag=>`<span class="codex-tag">${codexEsc(tag)}</span>`).join('')}</div>`}
  function codexAbilities(abilities){return `<div class="codex-ability-list">${abilities.map(([name,effect])=>`<div class="codex-ability"><b>${codexEsc(name)}</b><p>${codexEsc(effect)}</p></div>`).join('')}</div>`}
  function renderCodexCharacter(item){
    const hero=HEROES[item.id],starter=hero.starter&&codexWeaponItem(hero.starter);
    codexDetail.style.setProperty('--codex-color',item.codexColor);
    codexDetail.innerHTML=codexHero(item,item.summary)+
      `<section class="codex-section"><h4>ВСЕ БАЗОВЫЕ ХАРАКТЕРИСТИКИ</h4>${codexStats(codexHeroStats(item))}</section>`+
      `<section class="codex-section"><h4>ВОЗМОЖНОСТИ И ОГРАНИЧЕНИЯ</h4>${codexAbilities(item.abilities)}</section>`+
      `<section class="codex-section"><h4>СТИЛЬ ИГРЫ</h4>${codexTags(item.tags)}</section>`+
      (starter?`<section class="codex-section"><h4>СТАРТОВОЕ СНАРЯЖЕНИЕ</h4><div class="codex-links">${codexLink('weapons',starter.id,starter.icon,starter.name,'Стартует на 1-м уровне')}</div></section>`:'')+
      `<p class="codex-note">Характеристики указаны для обычной сложности на старте забега, до предметов, тотемов и временных усилений. В режиме «Хардкор» максимальное здоровье любого героя принудительно становится равно 1 HP.</p>`;
  }
  function renderCodexWeapon(item){
    const data=CODEX_WEAPONS[item.id]||{summary:codexDescription(item),stats:[],impacts:[]},evolution=evolutionUpgrades.find(entry=>entry.weapon===item.id),required=evolution&&codexRequiredItem(evolution),rarity=codexRarity(item);
    codexDetail.style.setProperty('--codex-color',rarity.color);
    codexDetail.innerHTML=codexHero(item,data.summary)+
      `<section class="codex-section"><h4>ХАРАКТЕРИСТИКИ ПО УРОВНЮ</h4>${codexStats(data.stats)}</section>`+
      `<section class="codex-section"><h4>ЧТО УСИЛИВАЕТ ОРУЖИЕ</h4>${codexTags(data.impacts)}</section>`+
      `<p class="codex-note"><b>L</b> — текущий уровень оружия от 1 до ${item.max}. Итоговый урон дополнительно умножается на урон героя, критические попадания и активные ситуационные бонусы. Формулы показывают базовые параметры до этих глобальных модификаторов.</p>`+
      (evolution?`<section class="codex-section"><h4>ЭВОЛЮЦИЯ</h4><div class="codex-links">${codexLink('evolutions',evolution.id,evolution.icon,evolution.name,`8-й уровень + ${required?.name||'нужный предмет'}`)}</div></section>`:'');
  }
  function renderCodexItem(item){
    const rarity=codexRarity(item),isBoss=bossRelics.includes(item),isResonance=riftResonanceUpgrades.includes(item),impacts=isResonance?(item.preview||[]).map(([label])=>label):CODEX_ITEM_IMPACTS[item.id]||['Особый эффект'],note=CODEX_ITEM_NOTES[item.id],evolutions=evolutionUpgrades.filter(entry=>entry.requires===item.id),unlockRequirement=itemUnlockRequirementText(item),rules=[['Максимальный ранг',isResonance?'Без предела':String(item.max)],['Редкость',rarity.label],['Слот',isBoss?'Отдельная босс-реликвия':isResonance?'Не занимает слот':'1 из 8 слотов предметов'],['Повторный выбор',isResonance?'Всегда повышает ранг':item.max===1?'Не повышается':'Повышает ранг']];
    if(isResonance)rules.push(['Появляется после','Исчерпания обычных улучшений и эволюций']);
    if(unlockRequirement)rules.push(['Появляется после',unlockRequirement]);
    codexDetail.style.setProperty('--codex-color',rarity.color);
    codexDetail.innerHTML=codexHero(item,codexDescription(item))+
      `<section class="codex-section"><h4>ПРАВИЛА ПРЕДМЕТА</h4>${codexStats(rules)}</section>`+
      `<section class="codex-section"><h4>ВЛИЯЕТ НА ХАРАКТЕРИСТИКИ</h4>${codexTags(impacts)}</section>`+
      `<section class="codex-section"><h4>ТОЧНЫЙ ЭФФЕКТ</h4><div class="codex-effect">${codexEsc(codexDescription(item))}</div>${note?`<p class="codex-note">${codexEsc(note)}</p>`:''}</section>`+
      (evolutions.length?`<section class="codex-section"><h4>ИСПОЛЬЗУЕТСЯ В ЭВОЛЮЦИИ</h4><div class="codex-links">${evolutions.map(evolution=>codexLink('evolutions',evolution.id,evolution.icon,evolution.name,WEAPON_INFO[evolution.weapon]?.name||'Оружие')).join('')}</div></section>`:'');
  }
  function renderCodexEvolution(item){
    const rarity=codexRarity(item),weapon=codexWeaponItem(item.weapon),required=codexRequiredItem(item),changes=CODEX_EVOLUTION_STATS[item.id]||[];
    codexDetail.style.setProperty('--codex-color',rarity.color);
    codexDetail.innerHTML=codexHero(item,codexDescription(item))+
      `<section class="codex-section"><h4>УСЛОВИЕ ЭВОЛЮЦИИ</h4><div class="codex-effect"><b>${codexEsc(weapon?.name||item.weapon)}</b> должен достигнуть 8-го уровня, а <b>${codexEsc(required?.name||item.requires)}</b> — находиться в текущем билде. Эволюция имеет строго один ранг.</div></section>`+
      `<section class="codex-section"><h4>ИЗМЕНЕНИЯ ОРУЖИЯ</h4>${codexStats(changes.map((value,index)=>[`Модификатор ${String(index+1).padStart(2,'0')}`,value]))}</section>`+
      `<section class="codex-section"><h4>СВЯЗАННЫЕ ЗАПИСИ</h4><div class="codex-links">${codexLink('weapons',weapon.id,weapon.icon,weapon.name,'Базовое оружие')}${codexLink('items',required.id,required.icon,required.name,'Требуемый предмет')}</div></section>`;
  }
  function renderCodexDetail(item){
    if(!item){codexDetail.style.removeProperty('--codex-color');codexDetail.innerHTML='<div class="codex-detail-placeholder">Ничего не найдено. Измените поисковый запрос.</div>';return}
    if(codexTab==='heroes')renderCodexCharacter(item);else if(codexTab==='weapons')renderCodexWeapon(item);else if(codexTab==='items')renderCodexItem(item);else renderCodexEvolution(item);
  }
  function renderCodex(){
    const query=codexSearch.value.trim().toLocaleLowerCase('ru'),all=codexEntries(),visible=query?all.filter(item=>codexSearchText(item,codexTab).includes(query)):all;
    if(!visible.some(item=>item.id===codexSelectedId))codexSelectedId=visible[0]?.id||'';
    $$('.codex-tab').forEach(tab=>{const selected=tab.dataset.codexTab===codexTab;tab.classList.toggle('selected',selected);tab.setAttribute('aria-selected',String(selected));});
    codexList.innerHTML=visible.length?visible.map(item=>{const rarity=codexRarity(item),selected=item.id===codexSelectedId,subtitle=codexTab==='heroes'?item.role:codexTab==='evolutions'?`${WEAPON_INFO[item.weapon]?.name||item.weapon} · ${rarity.label}`:`${item.type} · ${rarity.label}`,rank=codexTab==='heroes'?'ГЕРОЙ':item.max===1?'1 РАНГ':`MAX ${item.max}`;return `<button class="codex-entry${selected?' selected':''}" type="button" data-codex-id="${item.id}" style="--codex-color:${rarity.color}" aria-current="${selected?'true':'false'}"><span class="codex-entry-icon">${codexEsc(item.icon)}</span><span class="codex-entry-copy"><b>${codexEsc(item.name)}</b><small>${codexEsc(subtitle)}</small></span><span class="codex-entry-rank">${rank}</span></button>`}).join(''):'<div class="codex-empty">По этому запросу записей нет.<br>Попробуйте другое название или характеристику.</div>';
    renderCodexDetail(visible.find(item=>item.id===codexSelectedId));
  }
  function syncCodexCounts(){
    const heroes=codexEntries('heroes').length,weapons=codexEntries('weapons').length,items=codexEntries('items').length,evolutions=codexEntries('evolutions').length;
    $('#codexHeroesCount').textContent=heroes;$('#codexWeaponsCount').textContent=weapons;$('#codexItemsCount').textContent=items;$('#codexEvolutionsCount').textContent=evolutions;$('#codexSummary').textContent=`${heroes} героев · ${weapons} оружий · ${items} предметов · ${evolutions} эволюций`;
  }
  function openCodex(tab='weapons',id='',returnFocus=document.activeElement){codexReturnFocus=returnFocus;codexTab=['heroes','weapons','items','evolutions'].includes(tab)?tab:'weapons';codexSelectedId=id;codexSearch.value='';syncCodexCounts();renderCodex();codexModal.classList.remove('hidden');setTimeout(()=>codexSearch.focus(),0);audio.init();audio.tone(540,.1,'triangle',.022)}
  function closeCodex(){codexModal.classList.add('hidden');if(codexReturnFocus?.isConnected)codexReturnFocus.focus();codexReturnFocus=null}
  $$('.codex-tab').forEach(tab=>tab.addEventListener('click',()=>{codexTab=tab.dataset.codexTab;codexSelectedId='';renderCodex()}));
  codexSearch.addEventListener('input',renderCodex);
  codexList.addEventListener('click',event=>{const entry=event.target.closest('[data-codex-id]');if(!entry)return;codexSelectedId=entry.dataset.codexId;renderCodex();codexList.querySelector(`[data-codex-id="${codexSelectedId}"]`)?.scrollIntoView({block:'nearest'})});
  codexDetail.addEventListener('click',event=>{const link=event.target.closest('[data-codex-open-tab]');if(!link)return;codexTab=link.dataset.codexOpenTab;codexSelectedId=link.dataset.codexOpenId;codexSearch.value='';renderCodex()});
  $('#codexBtn').addEventListener('click',event=>openCodex('weapons','',event.currentTarget));$('#codexBtnPause').addEventListener('click',event=>openCodex('weapons','',event.currentTarget));$('#codexCloseBtn').addEventListener('click',closeCodex);codexModal.addEventListener('click',event=>{if(event.target===codexModal)closeCodex()});

  // ---------- LAN co-op ----------
  const coopModal=$('#coopModal');
  function coopStatus(text,error=false){const el=$('#coopStatus');el.textContent=text;el.classList.toggle('error',error);}
  function playerName(fallback='Игрок'){return ($('#coopName').value.trim()||fallback).slice(0,24);}
  function sendCoop(message){const socket=coopNet.socket;if(socket&&socket.readyState===WebSocket.OPEN)try{socket.send(JSON.stringify(message));}catch(_error){}}
  function websocketUrl(){return location.protocol==='http:'||location.protocol==='https:'?`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`:'';}
  function closeCoop(reset=true){
    coopNet.manualClose=true;clearTimeout(coopNet.reconnectTimer);if(coopNet.socket)try{coopNet.socket.close();}catch(_error){}
    coopNet.socket=null;coopNet.connected=false;if(reset){coopNet.mode='solo';coopNet.room='';coopNet.peerReady=null;coopNet.guestConfig=null;}
  }
  function resetLobby(){
    $('#coopActions').classList.remove('hidden');$('#coopLobby').classList.add('hidden');$('#coopStartBtn').disabled=true;coopStatus(websocketUrl()?'Выберите: создать комнату или подключиться по коду':'Откройте игру через COOP.bat, чтобы запустить локальный сервер',!websocketUrl());
  }
  function openCoopModal(){coopModal.classList.remove('hidden');resetLobby();setTimeout(()=>$('#coopName').focus(),0);audio.init();audio.tone(470,.1,'triangle',.025);}
  function closeCoopModal(){if(state.mode==='menu')closeCoop();coopModal.classList.add('hidden');}
  function updateLobby(role,message){
    $('#coopActions').classList.add('hidden');$('#coopLobby').classList.remove('hidden');$('#coopRoomCode').textContent=coopNet.room||'----';
    if(role==='host'){
      const address=(message.addresses||[]).find(item=>!item.includes('127.0.0.1'))||location.href;$('#coopAddress').textContent=`Второй компьютер: ${address}`;
      $('#coopPlayers').innerHTML='';const host=document.createElement('span'),guest=document.createElement('span');host.textContent=`1. ${playerName('Хост')} (хост)`;guest.textContent='2. Ожидание игрока…';guest.className='waiting';$('#coopPlayers').append(host,guest);$('#coopStartBtn').classList.remove('hidden');
    }else{
      $('#coopAddress').textContent='Подключено. Хост запустит забег, когда будет готов.';$('#coopPlayers').innerHTML='';const host=document.createElement('span'),guest=document.createElement('span');host.textContent=`1. ${message.hostName||'Хост'} (хост)`;guest.textContent=`2. ${playerName('Игрок 2')} (вы)`;$('#coopPlayers').append(host,guest);$('#coopStartBtn').classList.add('hidden');
    }
  }
  function connectCoop(role,room='',reconnect=false){
    const url=websocketUrl();if(!url){coopStatus('Сначала запустите COOP.bat и откройте адрес http://localhost:8787',true);return;}
    if(coopNet.socket&&coopNet.socket.readyState<2){coopNet.manualClose=true;coopNet.socket.close();}
    coopNet.mode=role;coopNet.room=room;coopNet.manualClose=false;coopStatus(reconnect?'Переподключение…':'Подключение к серверу…');
    const socket=new WebSocket(url);coopNet.socket=socket;
    socket.addEventListener('open',()=>{coopNet.connected=true;sendCoop({type:'hello',role,room:coopNet.room,name:playerName(role==='host'?'Хост':'Игрок 2'),version:'17'});});
    socket.addEventListener('message',event=>{let message;try{message=JSON.parse(event.data);}catch(_error){return;}handleCoopMessage(message);});
    socket.addEventListener('close',()=>{
      if(coopNet.socket!==socket)return;coopNet.connected=false;
      if(!coopNet.manualClose&&role==='guest'&&coopNet.room){coopStatus('Связь потеряна — переподключение…',true);clearTimeout(coopNet.reconnectTimer);coopNet.reconnectTimer=setTimeout(()=>connectCoop('guest',coopNet.room,true),1800);}
      else if(!coopNet.manualClose){coopStatus(role==='host'?'Сервер отключён. Забег продолжится без второго игрока.':'Связь с хостом потеряна',true);}
    });
    socket.addEventListener('error',()=>coopStatus('Не удалось подключиться. Проверьте COOP.bat и брандмауэр.',true));
  }
  function handleCoopMessage(message){
    if(message.type==='error'){coopStatus(message.message||'Ошибка подключения',true);return;}
    if(message.type==='room'){
      coopNet.room=message.room;updateLobby(message.role,message);coopStatus(message.role==='host'?'Комната создана. Ждём второго игрока.':'Готово. Ожидаем запуска хостом.');
      if(message.role==='guest')sendCoop({type:'ready',name:playerName('Игрок 2'),hero:selectedHero,graphics:selectedGraphics});return;
    }
    if(message.type==='peer'){
      if(coopNet.mode==='host'&&message.status==='guest-joined'){coopStatus(`${message.name||'Игрок 2'} подключился — получаем настройки…`);}
      if(message.status==='guest-left'){
        const actor=actorById('p2');if(actor){actor.connected=false;actor.input={x:0,z:0};}$('#coopStartBtn').disabled=true;coopStatus('Второй игрок отключился. Можно дождаться переподключения.',true);updatePeerHud();
      }
      if(message.status==='host-left')coopStatus('Хост завершил комнату',true);return;
    }
    if(coopNet.mode==='host'){
      if(message.type==='ready'){
        coopNet.peerReady={name:String(message.name||'Игрок 2').slice(0,24),hero:HEROES[message.hero]?message.hero:'vanguard'};
        const entries=$('#coopPlayers').children;if(entries[1]){entries[1].textContent=`2. ${coopNet.peerReady.name}`;entries[1].className='ready';}$('#coopStartBtn').disabled=false;coopStatus('Оба игрока готовы. Можно начинать.');
        const actor=actorById('p2');if(state.mode==='playing'&&actor){actor.connected=true;actor.name=coopNet.peerReady.name;sendRunState();sendSnapshot(true);resendActorChoice(actor);}return;
      }
      if(message.type==='input'){const actor=actorById('p2');if(actor){actor.input={x:clamp(Number(message.x)||0,-1,1),z:clamp(Number(message.z)||0,-1,1)};actor.firstPerson=Boolean(message.firstPerson);if(Number.isFinite(Number(message.aimYaw)))actor.aimYaw=Number(message.aimYaw);if(Number.isFinite(Number(message.aimPitch)))actor.aimPitch=clamp(Number(message.aimPitch),-.55,.45);const targetNid=Math.max(0,Math.floor(Number(message.targetNid)||0));actor.entity.lockedTargetNid=targetNid&&enemies.some(enemy=>enemy.nid===targetNid&&!enemy.dead)?targetNid:0;actor.lastInput=performance.now();actor.lastInputSeq=Math.max(actor.lastInputSeq||0,Number(message.seq)||0);}return;}
      if(message.type==='target'){const actor=actorById('p2');if(actor){const targetNid=Math.max(0,Math.floor(Number(message.targetNid)||0));actor.entity.lockedTargetNid=targetNid&&enemies.some(enemy=>enemy.nid===targetNid&&!enemy.dead)?targetNid:0;actor.entity.prismTarget=0;actor.entity.prismLock=0;}return;}
      if(message.type==='choice'){applyCompactChoice(actorById('p2'),clamp(Math.floor(Number(message.index)||0),0,2));return;}
      if(message.type==='choice-action'){compactChoiceAction(actorById('p2'),String(message.action||''));return;}
      if(message.type==='debug'){const actor=actorById('p2'),result=executeDebugCommand(String(message.line||''),actor);if(!$('#devConsole').classList.contains('hidden'))consoleLine(`[ГОСТЬ] ${message.line}`,'command');sendCoop({type:'event',event:'debug-result',actorId:'p2',ok:result.ok,text:result.text});return;}
      if(message.type==='request-sync'){if(state.mode==='end')sendCoop({type:'game-over',win:Boolean(state.runWon),time:state.time,runPace:state.runPace,runDuration:runDuration(),timelineScale:runTimelineScale(),xpPace:state.xpPace});else{sendRunState();sendSnapshot(true);}return;}
    }else if(coopNet.mode==='guest'){
      if(message.type==='run-state'){startRemoteRun(message);return;}
      if(message.type==='snapshot'){applySnapshot(message);return;}
      if(message.type==='choice-offer'){if(message.actorId==='p2'){renderCompactChoice(message.kind,message.choices,true,message.mode||'',message.meta||null);$('#coopChoicePanel').classList.remove('waiting');}return;}
      if(message.type==='event'&&message.event==='choice-picked'&&message.actorId==='p2'){$('#coopChoicePanel').classList.add('hidden');$('#coopChoicePanel').classList.remove('waiting');coopNet.buildDirty=true;return;}
      if(message.type==='event'&&message.event==='continue-endless'){state.time=Number(message.time)||state.time;enterEndless(true);return;}
      if(message.type==='event'&&message.event==='debug-result'&&message.actorId==='p2'){consoleLine(message.text,message.ok?'ok':'error');coopNet.buildDirty=true;return;}
      if(message.type==='game-over'){showRemoteEnd(Boolean(message.win),message);return;}
    }
  }
  function startCoopHost(){
    if(coopNet.mode!=='host'||!coopNet.peerReady)return;audio.init();state=makeRun();state.coop=true;player={x:-1.3,z:0,y:0,dir:0,moving:false};enemies=[];activeStandards=[];projectiles=[];enemyProjectiles=[];gems=[];particles=[];beams=[];zones=[];consumables=[];worldTotems=[];pendingLevels=0;pendingChests=0;shake=0;uiTick=uiSlowTick=0;nextNetId=1;setCameraMode('overhead',false);
    const host=captureLocalActor('p1',playerName('Хост')),guest=createActor('p2',coopNet.peerReady.name,coopNet.peerReady.hero,state.hardcore);host.entity=player;host.local=true;guest.local=false;coopActors=[host,guest];remotePlayer=guest.entity;
    for(const actor of coopActors)applyChallengeLoadout(actor);
    document.body.classList.toggle('rtx-mode',state.graphics==='rtx');$('#menu').classList.remove('active');coopModal.classList.add('hidden');$('#hud').classList.remove('hidden');$('#endScreen').classList.add('hidden');$('#pauseScreen').classList.add('hidden');$('#choiceScreen').classList.add('hidden');$('#coopPeerHud').classList.remove('hidden');
    for(let i=0;i<12;i++){const e=spawnEnemy(i%4===0?'runner':'grunt'),focus=spawnFocus(),a=i/12*TAU,d=10+(i%3)*2;e.x=focus.x+Math.cos(a)*d;e.z=focus.z+Math.sin(a)*d;}
    updateSlots();updateUI(true);updatePeerHud();sendRunState();sendSnapshot(true);toast(`<b>${state.challengeName}</b> · SEED ${state.seedCode}`,'#ffbd3d');audio.tone(440,.15,'sawtooth',.04);
  }
  function sendRunState(){sendCoop({type:'run-state',difficulty:state.difficulty,hardcore:state.hardcore,custom:state.custom,totems:state.totems,time:state.time,runPace:state.runPace,runDuration:runDuration(),timelineScale:runTimelineScale(),xpPace:state.xpPace,challenge:state.challenge,challengeName:state.challengeName,seedCode:state.seedCode,bossOrder:state.bossOrder,endless:Boolean(state.endless),endlessNextBoss:state.endlessNextBoss,endlessNextTotem:state.endlessNextTotem});}
  function actorWire(actor){const stats={...actor.stats};delete stats.damageHistory;delete stats.recentDamage;return{id:actor.id,name:actor.name,hero:actor.hero,hardcore:actor.hardcore,connected:actor.connected,invuln:actor.invuln||0,debugGod:Boolean(actor.debugGod),inputAck:actor.lastInputSeq||0,entity:{x:netRound(actor.entity.x),z:netRound(actor.entity.z),dir:netRound(actor.entity.dir),moving:Boolean(actor.entity.moving),lockedTargetNid:Math.max(0,Math.floor(Number(actor.entity.lockedTargetNid)||0))},stats,weapons:{...actor.weapons},relics:{...actor.relics},buffs:{...actor.buffs}};}
  function sendSnapshot(force=false){
    const socket=coopNet.socket;if(coopNet.mode!=='host'||!coopNet.connected||!socket||socket.readyState!==WebSocket.OPEN||socket.bufferedAmount>384*1024)return;const guest=actorById('p2');if(!guest)return;
    const enemyLimit=enemies.length>700?320:enemies.length>400?380:460,visibleEnemies=netVisible(enemies.filter(e=>!e.dead),guest.entity,enemyLimit,52,e=>e.boss||e.miniboss||e.nid===guest.entity.lockedTargetNid),visibleProjectiles=netVisible(projectiles,guest.entity,200,48),visibleEnemyProjectiles=netVisible(enemyProjectiles,guest.entity,120,50),visibleGems=netVisible(gems,guest.entity,160,46),visibleZones=netVisible(zones,guest.entity,100,48),visibleConsumables=netVisible(consumables,guest.entity,32,50),visibleTotems=netVisible(worldTotems,guest.entity,12,58);
    const snapshot={type:'snapshot',net:2,seq:++coopNet.seq,time:netRound(state.time),runPace:state.runPace,runDuration:runDuration(),timelineScale:runTimelineScale(),xpPace:state.xpPace,challenge:state.challenge,challengeName:state.challengeName,seedCode:state.seedCode,threatTier:state.threatTier,nextHorde:netRound(state.nextHorde),hordeRemaining:state.hordeRemaining,hordeDuration:netRound(state.hordeDuration),hordes:state.hordes,totems:state.totems,difficulty:state.difficulty,endless:Boolean(state.endless),endlessNextBoss:state.endlessNextBoss,endlessNextTotem:state.endlessNextTotem,actors:coopActors.map(actorWire),
      enemies:visibleEnemies.map(packEnemy),projectiles:visibleProjectiles.map(packProjectile),enemyProjectiles:visibleEnemyProjectiles.map(packProjectile),
      gems:visibleGems.map(g=>[netRound(g.x),netRound(g.z),netColorIndex(g.color)]),zones:visibleZones.map(packZone),consumables:visibleConsumables.map(c=>[netRound(c.x),netRound(c.z),c.type,netRound(c.seed)]),worldTotems:visibleTotems.map(t=>[netRound(t.x),netRound(t.z),netRound(t.seed)]),beams:netVisible(beams.map(beam=>({...beam,x:(beam.x1+beam.x2)/2,z:(beam.z1+beam.z2)/2})),guest.entity,60,52).map(b=>[netRound(b.x1),netRound(b.z1),netRound(b.x2),netRound(b.z2),netRound(b.life),netRound(b.max),netColorIndex(b.color)])};
    sendCoop(snapshot);if(force)coopNet.snapshotClock=.12;
  }
  function startRemoteRun(message){
    const shell=makeRun(),pace=RUN_PACES[message.runPace]||RUN_PACES.standard,challenge=CHALLENGES[message.challenge]?message.challenge:'classic';state={...shell,mode:'remote',coop:true,time:Number(message.time)||0,runPace:RUN_PACES[message.runPace]?message.runPace:'standard',runDuration:Number(message.runDuration)||pace.duration,timelineScale:Number(message.timelineScale)||pace.timelineScale,xpPace:Number(message.xpPace)||pace.xpPace,challenge,challengeName:message.challengeName||CHALLENGES[challenge].name,seedCode:normalizeSeed(message.seedCode)||shell.seedCode,bossOrder:Array.isArray(message.bossOrder)?message.bossOrder:shell.bossOrder,difficulty:message.difficulty||shell.difficulty,hardcore:Boolean(message.hardcore),custom:Boolean(message.custom),totems:message.totems||{},endless:Boolean(message.endless),endlessNextBoss:Number(message.endlessNextBoss)||0,endlessNextTotem:Number(message.endlessNextTotem)||0};enemies=[];activeStandards=[];projectiles=[];enemyProjectiles=[];gems=[];particles=[];beams=[];zones=[];consumables=[];worldTotems=[];coopActors=[];nextNetId=1;coopNet.lastSnapshotSeq=0;coopNet.buildReady=false;coopNet.buildDirty=false;coopNet.totemKey='';setCameraMode('overhead',false);
    document.body.classList.toggle('rtx-mode',selectedGraphics==='rtx');$('#menu').classList.remove('active');coopModal.classList.add('hidden');$('#hud').classList.remove('hidden');$('#endScreen').classList.add('hidden');$('#pauseScreen').classList.add('hidden');$('#choiceScreen').classList.add('hidden');$('#coopPeerHud').classList.remove('hidden');coopStatus('Забег запущен');
  }
  function applySnapshot(snapshot){
    if(coopNet.mode!=='guest'||!['remote','end'].includes(state.mode))return;const previousLocalTarget=actorById('p2')?.entity?.lockedTargetNid||0,sequence=Number(snapshot.seq)||0;if(sequence&&sequence<=coopNet.lastSnapshotSeq)return;coopNet.lastSnapshotSeq=sequence;coopNet.lastSnapshot=performance.now();if(state.mode==='end')return;state.time=Number(snapshot.time)||state.time;if(RUN_PACES[snapshot.runPace])state.runPace=snapshot.runPace;state.runDuration=Number(snapshot.runDuration)||state.runDuration;state.timelineScale=Number(snapshot.timelineScale)||state.timelineScale;state.xpPace=Number(snapshot.xpPace)||state.xpPace;if(CHALLENGES[snapshot.challenge])state.challenge=snapshot.challenge;state.challengeName=snapshot.challengeName||CHALLENGES[state.challenge]?.name||state.challengeName;state.seedCode=normalizeSeed(snapshot.seedCode)||state.seedCode;state.threatTier=snapshot.threatTier||0;state.nextHorde=snapshot.nextHorde||0;state.hordeRemaining=snapshot.hordeRemaining||0;state.hordeDuration=Number(snapshot.hordeDuration)||0;state.hordes=snapshot.hordes||0;state.totems=snapshot.totems||{};state.difficulty=snapshot.difficulty||state.difficulty;state.endless=Boolean(snapshot.endless);state.endlessNextBoss=Number(snapshot.endlessNextBoss)||0;state.endlessNextTotem=Number(snapshot.endlessNextTotem)||0;
    const previous=new Map(coopActors.map(actor=>[actor.id,actor]));coopActors=(snapshot.actors||[]).map(data=>{const actor=previous.get(data.id)||createActor(data.id,data.name,data.hero,data.hardcore);actor.name=data.name;actor.hero=data.hero;actor.hardcore=data.hardcore;actor.connected=data.connected;actor.invuln=data.invuln||0;actor.debugGod=Boolean(data.debugGod);actor.lastInputAck=data.inputAck||0;actor.stats=data.stats;actor.weapons=data.weapons;actor.relics=data.relics;actor.buffs=data.buffs;actor.local=data.id==='p2';actor.entity.tx=data.entity.x;actor.entity.tz=data.entity.z;actor.entity.dir=data.entity.dir;actor.entity.moving=data.entity.moving;actor.entity.lockedTargetNid=Math.max(0,Math.floor(Number(data.entity.lockedTargetNid)||0));if(!previous.has(data.id)){actor.entity.x=data.entity.x;actor.entity.z=data.entity.z;}return actor;});
    const local=actorById('p2');if(local){player=local.entity;state.stats=local.stats;state.weapons=local.weapons;state.relics=local.relics;state.buffs=local.buffs;state.hero=local.hero;state.hardcore=local.hardcore;if(previousLocalTarget&&!local.entity.lockedTargetNid)toast('<b>ЦЕЛЬ УНИЧТОЖЕНА</b> · автоприцел восстановлен','#63ffb0');}remotePlayer=actorById('p1')?.entity||null;
    const compact=snapshot.net===2,enemyData=(snapshot.enemies||[]).map(data=>compact?unpackEnemy(data):data),oldEnemies=new Map(enemies.map(e=>[e.nid,e]));enemies=enemyData.map(data=>{const previousEnemy=oldEnemies.get(data.nid),e=previousEnemy||{x:data.x,z:data.z},oldX=e.x,oldZ=e.z;Object.assign(e,data,{tx:data.x,tz:data.z,dead:false});if(previousEnemy){e.x=oldX;e.z=oldZ;}return e;});
    if(compact){projectiles=(snapshot.projectiles||[]).map(unpackProjectile);enemyProjectiles=(snapshot.enemyProjectiles||[]).map(unpackProjectile);gems=(snapshot.gems||[]).map(g=>({x:g[0],z:g[1],color:NET_COLORS[g[2]]||COLORS.cyan}));zones=(snapshot.zones||[]).map(unpackZone);consumables=(snapshot.consumables||[]).map(c=>({x:c[0],z:c[1],type:c[2],seed:c[3]}));worldTotems=(snapshot.worldTotems||[]).map(t=>({x:t[0],z:t[1],seed:t[2]}));beams=(snapshot.beams||[]).map(b=>({x1:b[0],z1:b[1],x2:b[2],z2:b[3],life:b[4],max:b[5],color:NET_COLORS[b[6]]||COLORS.cyan}));}else{projectiles=(snapshot.projectiles||[]).map(p=>({...p,hit:new Set()}));enemyProjectiles=(snapshot.enemyProjectiles||[]).map(p=>({...p}));gems=(snapshot.gems||[]).map(g=>({...g}));zones=(snapshot.zones||[]).map(z=>({...z}));consumables=(snapshot.consumables||[]).map(c=>({...c}));worldTotems=(snapshot.worldTotems||[]).map(t=>({...t}));beams=(snapshot.beams||[]).map(b=>({...b}));}
    const totemKey=Object.entries(state.totems).sort(([a],[b])=>a.localeCompare(b)).map(([id,level])=>`${id}:${level}`).join('|');if(!coopNet.buildReady||coopNet.buildDirty||totemKey!==coopNet.totemKey){coopNet.buildReady=true;coopNet.buildDirty=false;coopNet.totemKey=totemKey;updateSlots();}updatePeerHud();
  }
  function currentInput(){let x=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+touchMove.x,z=(keys.KeyS||keys.ArrowDown?1:0)-(keys.KeyW||keys.ArrowUp?1:0)+touchMove.z,l=Math.hypot(x,z);if(l>1){x/=l;z/=l;}return cameraRelativeInput(x,z);}
  function updateGuest(dt){
    const local=actorById('p2'),input=currentInput(),inputAmount=Math.hypot(input.x,input.z),blend=1-Math.exp(-10*dt);if(local?.stats.hp>0){const buffStrength=Math.max(.6,1-(local.stats.reversedClock||0)*.03),speed=local.stats.speed*(local.buffs.speed>0?1+.7*buffStrength:1)*(local.stats.bloodContract&&local.stats.hp<local.stats.maxHp*.5?1.12:1);local.entity.x+=input.x*speed*dt;local.entity.z+=input.z*speed*dt;if(inputAmount>.05){local.entity.moveDir=Math.atan2(input.z,input.x);local.entity.moving=true;}else local.entity.moving=false;local.entity.dir=isFirstPerson()?cameraYaw:local.entity.moveDir??local.entity.dir;}
    for(const actor of coopActors){if(Number.isFinite(actor.entity.tx)){let strength=blend;if(actor.local){const error=Math.hypot(actor.entity.tx-actor.entity.x,actor.entity.tz-actor.entity.z);strength=inputAmount>.05?(error>6?blend*.045:0):blend*.48;}actor.entity.x+=(actor.entity.tx-actor.entity.x)*strength;actor.entity.z+=(actor.entity.tz-actor.entity.z)*strength;}}
    for(const e of enemies){e.x+=(e.tx-e.x)*blend;e.z+=(e.tz-e.z)*blend;e.hit=Math.max(0,(e.hit||0)-dt);}for(const p of projectiles){p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=(p.vy||0)*dt;if(p.kind==='saw')p.spin=(p.spin||0)+dt*18;}for(const p of enemyProjectiles){p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=(p.vy||0)*dt;p.spin=(p.spin||0)+dt*5;}
    coopNet.inputClock-=dt;if(coopNet.inputClock<=0){sendCoop({type:'input',x:input.x,z:input.z,firstPerson:isFirstPerson(),aimYaw:cameraYaw,aimPitch:cameraPitch,targetNid:Math.max(0,Math.floor(Number(local?.entity.lockedTargetNid)||0)),seq:++coopNet.seq});coopNet.inputClock=.05;}uiTick-=dt;uiSlowTick-=dt;if(uiTick<=0){const refreshSlow=uiSlowTick<=0;updateUI(refreshSlow);uiTick=.05;if(refreshSlow)uiSlowTick=.2;}
    if(performance.now()-coopNet.lastSnapshot>4500)coopStatus('Нет данных от хоста — пытаемся восстановить связь…',true);
  }
  function updatePeerHud(){
    if(!isCoop()){$('#coopPeerHud').classList.add('hidden');return;}const peer=actorById(coopNet.mode==='guest'?'p1':'p2');if(!peer)return;$('#coopPeerHud').classList.remove('hidden');$('#coopPeerName').textContent=peer.connected?peer.name:`${peer.name} · ОТКЛЮЧЕН`;$('#coopPeerHp').textContent=`${Math.ceil(peer.stats.hp)} / ${Math.ceil(peer.stats.maxHp)}`;$('#coopPeerHpBar').style.width=`${clamp(peer.stats.hp/peer.stats.maxHp*100,0,100)}%`;$('#coopPeerLevel').textContent=`УРОВЕНЬ ${peer.stats.level}`;
  }
  function showRemoteEnd(win,message={}){if(state.mode==='end')return;state.time=Number(message.time)||state.time;if(RUN_PACES[message.runPace])state.runPace=message.runPace;state.runDuration=Number(message.runDuration)||state.runDuration;state.timelineScale=Number(message.timelineScale)||state.timelineScale;state.xpPace=Number(message.xpPace)||state.xpPace;endGame(win,true);}

  // ---------- Test console ----------
  const devConsole=$('#devConsole'),devInput=$('#devConsoleInput'),devLog=$('#devConsoleLog'),devHistory=[];let devHistoryIndex=0,devWelcomed=false;
  const DEBUG_HELP=`КОМАНДЫ ТЕСТИРОВАНИЯ
help                         справка
god [on|off]                 бессмертие выбранного игрока
time <сек|15m|15:00>         установить время забега
level <значение> [choices]   установить уровень; choices добавит выборы
xp <количество>              выдать опыт
gear <test|broken|reset>     тестовый, сломанный или чистый билд
weapon <id|all> <уровень>    установить уровень оружия
hero <id>                    переключить героя и сбросить его билд
herocheck                    принудительно проверить способность героя
item <id> [ранги]            выдать предмет/улучшение
unlock <id>                  проверить доступность предмета в прокачке
evolve <оружие|all>          выдать условия и эволюционировать оружие
bossrelic <id|all>           выдать уникальную реликвию босса
choice <level|boss|totem>    открыть нужный тестовый выбор
endless                      сразу войти в Бесконечный Разлом
heal                         полностью вылечить
spawn <тип> [количество]     создать врагов
boss [тип] [количество]      создать боссов · breaker/worm/architect/swarmking/mirror
bossattack                   немедленно запустить особую атаку босса
bossphase <1|2> [near]       включить фазу босса; near ставит его рядом
horde [количество]           запустить орду
threat <0-27>                установить уровень угрозы
mapcheck                     проверить стены, движение и линии огня
enemies clear                удалить врагов и вражеские снаряды
status                       текущие параметры
kill | win                   завершить забег поражением или победой
weapons | items | enemies    показать доступные идентификаторы
clear                        очистить консоль`;
  function consoleLine(text,type='info'){const line=document.createElement('div');line.className=`dev-console-line ${type}`;line.textContent=String(text);devLog.append(line);while(devLog.children.length>220)devLog.firstElementChild.remove();devLog.scrollTop=devLog.scrollHeight;}
  function toggleDevConsole(force){const open=force??devConsole.classList.contains('hidden');devConsole.classList.toggle('hidden',!open);keys={};resetFloatingStick();if(open){releaseCameraPointerLock();if(!devWelcomed){consoleLine('Тестовая консоль активна. Введите help для списка команд.','ok');devWelcomed=true;}setTimeout(()=>devInput.focus(),0);}else{devInput.blur();requestCameraPointerLock();}}
  function debugTokens(line){return(line.match(/"[^"]*"|'[^']*'|\S+/g)||[]).map(token=>token.replace(/^("|')|("|')$/g,''));}
  function debugTime(value){const raw=String(value||'').trim().toLowerCase();if(/^\d{1,3}:\d{1,2}$/.test(raw)){const [minutes,seconds]=raw.split(':').map(Number);return minutes*60+seconds;}if(raw.endsWith('m'))return Number(raw.slice(0,-1))*60;if(raw.endsWith('s'))return Number(raw.slice(0,-1));return Number(raw);}
  function debugToggle(value,current){const word=String(value||'toggle').toLowerCase();if(['on','1','true','да','вкл'].includes(word))return true;if(['off','0','false','нет','выкл'].includes(word))return false;return!current;}
  function resetDebugBuild(mode,actor){
    const old=state.stats,replacement=defaultStats(state.hero,state.hardcore),level=Math.max(1,old.level||1);replacement.level=level;replacement.xp=0;replacement.xpNeed=xpNeedForLevel(level);replacement.kills=old.kills||0;replacement.damageDone=old.damageDone||0;replacement.damageTaken=old.damageTaken||0;state.stats=replacement;state.weapons=freshWeapons();state.cooldowns=freshCooldowns();state.relics={};state.buffs=freshBuffs();pendingLevels=0;pendingChests=0;if(actor){actor.pendingTotems=0;actor.choice=null;}currentChoices=[];$('#coopChoicePanel').classList.add('hidden');$('#choiceScreen').classList.add('hidden');
    if(mode==='test'||mode==='broken'){
      const broken=mode==='broken',weaponLevel=broken?8:3,arsenal=Object.keys(state.weapons).slice(0,currentWeaponSlotLimit());for(const id of Object.keys(state.weapons))state.weapons[id]=arsenal.includes(id)?(id==='blaster'?(broken?8:5):weaponLevel):0;
      const s=state.stats;s.damageMult=s.baseDamage*(broken?18:3.2);s.fireRate=broken?8:2.6;s.projectiles=broken?8:3;s.pierce=broken?14:4;s.projSize=broken?2.5:1.45;s.projSpeed=broken?2.2:1.35;s.projectileDamage=broken?2:1.25;s.duration=broken?3:1.55;s.crit=broken?1:.42;s.critMult=broken?5:2.7;s.pickup=broken?80:10;s.xpMult=broken?4:1.5;s.echo=broken?2.5:.44;s.critExplosion=broken?4:1;s.chainBonus=broken?5:1;s.bossSlayer=broken?5:1;s.burnPower=broken?6:2;s.armor=broken?90:24;s.regen=broken?12:2.4;if(!state.hardcore){s.maxHp=broken?1200:260;s.hp=s.maxHp;}state.relics=broken?{power:10,haste:10,multishot:5,echo:5,criticalMass:4}:{power:5,haste:4,multishot:2,echo:2,criticalMass:1};
    }
  }
  function executeDebugCommand(line,actorOverride=null){
    const tokens=debugTokens(line);if(!tokens.length)return{ok:false,text:'Пустая команда'};let command=tokens[0].toLowerCase();const alias={помощь:'help',бог:'god',бессмертие:'god',время:'time',уровень:'level',опыт:'xp',билд:'gear',снаряжение:'gear',оружие:'weapon',герой:'hero',предмет:'item',доступ:'unlock',лечение:'heal',хил:'heal',враг:'spawn',босс:'boss',орда:'horde',угроза:'threat',карта:'mapcheck',статус:'status',смерть:'kill',победа:'win'};command=alias[command]||command;
    if(command==='help'||command==='?')return{ok:true,text:DEBUG_HELP};
    if(!state.stats||state.mode==='menu')return{ok:false,text:'Сначала запустите забег'};
    const actor=actorOverride||coopActors.find(item=>item.local)||coopActors[0],number=(index,fallback=0)=>Number.isFinite(Number(tokens[index]))?Number(tokens[index]):fallback;let text='Готово';
    try{withActor(actor,()=>{
      const s=state.stats;
      if(command==='god'){actor.debugGod=debugToggle(tokens[1],Boolean(actor.debugGod));text=`Бессмертие ${actor.name}: ${actor.debugGod?'ВКЛ':'ВЫКЛ'}`;}
      else if(command==='time'){const value=debugTime(tokens[1]);if(!Number.isFinite(value)||value<0)throw Error('Пример: time 05:00, time 5m или time 300');state.time=clamp(value,0,state.endless?359999:runDuration());text=`Время установлено: ${formatTime(state.time)}`;}
      else if(command==='level'||command==='lvl'){const target=Math.floor(clamp(number(1,NaN),1,999));if(!Number.isFinite(target))throw Error('Пример: level 30');const gained=Math.max(0,target-s.level);s.level=target;s.xp=0;s.xpNeed=xpNeedForLevel(s.level);if(tokens[2]?.toLowerCase()==='choices'&&gained){pendingLevels+=gained;if(state.mode==='playing'){if(isCoopHost())requestChoice('level');else openChoice('level');}}text=`Уровень ${actor.name}: ${target}${tokens[2]==='choices'?` · выборов ${gained}`:''}`;}
      else if(command==='xp'){const amount=number(1,NaN);if(!Number.isFinite(amount)||amount<=0)throw Error('Пример: xp 1000');gainXP(amount);text=`Выдано опыта: ${amount}`;}
      else if(command==='gear'){const mode=(tokens[1]||'test').toLowerCase();if(!['test','broken','reset'].includes(mode))throw Error('Допустимо: gear test, gear broken, gear reset');resetDebugBuild(mode,actor);text=mode==='reset'?'Билд сброшен':mode==='broken'?'Выдан максимально сломанный билд':'Выдан тестовый билд';}
      else if(command==='weapon'){const id=(tokens[1]||'').toLowerCase(),level=Math.floor(clamp(number(2,1),0,99)),limit=currentWeaponSlotLimit();if(id==='all'){const arsenal=Object.keys(state.weapons).slice(0,limit);for(const key of Object.keys(state.weapons))state.weapons[key]=level>0&&arsenal.includes(key)?level:0;text=`Заполнены ${limit} слотов оружия: уровень ${level}`;}else{if(!(id in state.weapons))throw Error(`Неизвестное оружие. Доступно: ${Object.keys(state.weapons).join(', ')}`);if(level>0&&!state.weapons[id]&&equippedWeaponIds().length>=limit)throw Error(`Все ${limit} слотов оружия заняты`);state.weapons[id]=level;text=`${id}: уровень ${level}`;}}
      else if(command==='hero'){const id=(tokens[1]||'').toLowerCase();if(!HEROES[id])throw Error(`Доступно: ${Object.keys(HEROES).join(', ')}`);if(state.heroCursedApplied){state.difficulty.health/=1.3;state.difficulty.damage/=1.15;state.heroCursedApplied=false;}state.hero=id;actor.hero=id;state.stats=defaultStats(id,state.hardcore);state.weapons=freshWeapons();state.cooldowns=freshCooldowns();state.relics={};state.buffs=freshBuffs();heroUnits=heroUnits.filter(unit=>unit.owner!==activeActorId);pendingLevels=0;pendingChests=0;currentChoices=[];applyHeroLoadout();text=`Герой переключён: ${HEROES[id].name} · старт ${equippedWeaponIds().map(weapon=>WEAPON_INFO[weapon].name).join(', ')||'собственная атака'}`;}
      else if(command==='herocheck'){const before=s.heroActivations||0;if(state.hero==='engineer'||state.hero==='chronomancer'){s.heroClock=0;updateHeroMechanics(0);}else if(state.hero==='necromancer'){s.kills=34;const target=spawnEnemy('grunt',false,false);placeEnemy(target,player.x+3,player.z);target.hp=1;target.maxHp=1;damageEnemy(target,2,'normal',false,true);}else if(state.hero==='voidwalker'){const target=spawnEnemy('grunt',false,false),hp=target.hp;placeEnemy(target,player.x+3,player.z);zones.push({owner:activeActorId,weapon:'gravity',x:target.x,z:target.z,radius:4,life:2,max:2,color:COLORS.violet,kind:'gravity',tick:0});updateZones(0);if(target.hp<hp)s.heroActivations=(s.heroActivations||0)+1;}else if(state.hero==='mimic'){const target=spawnEnemy('warden',false,false);target.elite=true;placeEnemy(target,player.x+7,player.z);s.mimicSpecialClock=0;updateHeroMechanics(0);}else{s.heroActivations=(s.heroActivations||0)+1;}const activated=(s.heroActivations||0)>before;if(!activated)throw Error(`Пассив ${HEROES[state.hero].name} не сработал`);text=`${HEROES[state.hero].name} · способность OK · активаций ${s.heroActivations}`;}
      else if(command==='item'){const id=tokens[1],count=Math.floor(clamp(number(2,1),1,99)),upgrade=upgrades.find(item=>item.id===id);if(!upgrade)throw Error('Неизвестный id. Введите items');if(!hasUpgradeSlot(upgrade))throw Error(upgrade.type==='ОРУЖИЕ'?`Все ${currentWeaponSlotLimit()} слотов оружия заняты`:`Все ${ITEM_SLOT_LIMIT} слотов предметов заняты`);let granted=0;for(let i=0;i<count;i++){const level=upgrade.level?upgrade.level():upCount(upgrade.id);if(level>=(upgrade.max||99)||upgrade.when&&!upgrade.when())break;upgrade.apply();state.relics[upgrade.id]=(state.relics[upgrade.id]||0)+1;granted++;}text=`${upgrade.name}: выдано рангов ${granted}`;}
      else if(command==='unlock'){const id=tokens[1]||'',upgrade=upgrades.find(item=>item.id===id&&ITEM_UNLOCK_RULES[item.id]);if(!upgrade)throw Error(`Предмет с условием не найден. Доступно: ${Object.keys(ITEM_UNLOCK_RULES).join(', ')}`);const available=itemUnlockedForBuild(upgrade);text=`${upgrade.name}: ${available?'ДОСТУПЕН':'ЗАБЛОКИРОВАН'} · требуется ${itemUnlockRequirementText(upgrade)}`;}
      else if(command==='evolve'){const id=(tokens[1]||'').toLowerCase(),requested=id==='all'?evolutionUpgrades:evolutionUpgrades.filter(item=>item.weapon===id);if(!requested.length)throw Error('Пример: evolve firetrail или evolve all');const targets=requested.filter(evolution=>state.weapons[evolution.weapon]>0||(equippedWeaponIds().length<currentWeaponSlotLimit()&&id!=='all'));for(const evolution of targets){state.weapons[evolution.weapon]=Math.max(8,state.weapons[evolution.weapon]||0);const requirement=upgrades.find(item=>item.id===evolution.requires);if(!upCount(evolution.requires)&&requirement){if(!hasUpgradeSlot(requirement))throw Error(`Для ${evolution.name} нужен предмет ${requirement.name}, но все слоты заняты`);requirement.apply();state.relics[requirement.id]=1;}state.relics[evolution.id]=1;}text=id==='all'?`Эволюционировано оружий: ${targets.length}`:`Эволюционировано: ${targets[0]?.name||'нет свободного слота'}`;}
      else if(command==='bossrelic'){const id=tokens[1]||'',targets=id==='all'?bossRelics:bossRelics.filter(item=>item.id===id);if(!targets.length)throw Error(`Доступно: ${bossRelics.map(item=>item.id).join(', ')}`);let granted=0;for(const relic of targets){if(upCount(relic.id)>=1||relic.when&&!relic.when())continue;relic.apply();state.relics[relic.id]=1;granted++;}text=id==='all'?`Выданы уникальные реликвии: ${granted}`:granted?`Выдано: ${targets[0].name}`:`${targets[0].name} уже получена`;}
      else if(command==='choice'){const kind=(tokens[1]||'level').toLowerCase();if(!['level','boss','totem','endless'].includes(kind))throw Error('Допустимо: choice level, choice boss, choice totem, choice endless');if(kind==='level')pendingLevels++;if(kind==='boss')pendingChests++;if(isCoopHost())requestChoice(kind);else openChoice(kind);text=`Открыт выбор: ${kind}`;}
      else if(command==='endless'){if(!state.endless){state.time=Math.max(runDuration(),state.time);enterEndless();}text='Бесконечный Разлом активирован';}
      else if(command==='heal'){s.hp=s.maxHp;text=`Здоровье восстановлено: ${Math.ceil(s.hp)}/${Math.ceil(s.maxHp)}`;}
      else if(command==='spawn'){const type=(tokens[1]||'grunt').toLowerCase(),count=Math.floor(clamp(number(2,1),1,500));if(!ENEMY_TYPES[type])throw Error(`Неизвестный тип. Доступно: ${Object.keys(ENEMY_TYPES).join(', ')}`);for(let i=0;i<count;i++){const enemy=spawnEnemy(type),angle=i/count*TAU,distance=rand(14,7);placeEnemy(enemy,player.x+Math.cos(angle)*distance,player.z+Math.sin(angle)*distance);}text=`Создано врагов ${type}: ${count}`;}
      else if(command==='boss'){const requested=(tokens[1]||'').toLowerCase(),kind=BOSS_ARCHETYPES[requested]?requested:'',count=Math.floor(clamp(number(kind?2:1,1),1,20));if(requested&&!kind&&!Number.isFinite(Number(requested)))throw Error(`Доступно: ${Object.keys(BOSS_ARCHETYPES).join(', ')}`);for(let i=0;i<count;i++)spawnBoss(kind);text=`Создано боссов: ${count}${kind?` · ${BOSS_ARCHETYPES[kind].name}`:''}`;}
      else if(command==='bossattack'){const bosses=enemies.filter(enemy=>(enemy.boss||enemy.miniboss)&&!enemy.dead);if(!bosses.length)throw Error('Сначала создайте босса: boss <тип>');for(const boss of bosses){boss.bossSpecialClock=0;boss.bossAttack=0;boss.bossWaveClock=0;}text=`Особая атака запущена · боссов ${bosses.length}`;}
      else if(command==='bossphase'){const phase=Math.floor(clamp(number(1,1),1,2));let boss=enemies.find(enemy=>(enemy.boss||enemy.miniboss)&&!enemy.dead);if(!boss)boss=spawnBoss();boss.hp=Math.min(boss.hp,boss.maxHp*(phase===1?.7:.35));if(phase===2)boss.bossSummonMask|=1;triggerBossPhase(boss,phase);if(tokens[2]?.toLowerCase()==='near')placeEnemy(boss,player.x+5,player.z);text=`Босс переведён в фазу ${phase}${tokens[2]?.toLowerCase()==='near'?' рядом с игроком':''}`;}
      else if(command==='horde'){const count=Math.floor(clamp(number(1,250),1,2000)),duration=pacedDelay(10);queueHorde(count,duration);text=`Орда добавлена: ${count} врагов · вход в течение ${duration.toFixed(1)} секунд`;}
      else if(command==='threat'){const target=Math.floor(clamp(number(1,NaN),0,state.endless?99:29));if(!Number.isFinite(target))throw Error('Пример: threat 20');const old=state.threatTier,oldGrowth=enemyGrowth(state.time,old),nextGrowth=enemyGrowth(state.time,target),hpRatio=nextGrowth.health/oldGrowth.health,damageRatio=nextGrowth.damage/oldGrowth.damage;state.threatTier=target;for(const enemy of enemies){enemy.hp*=hpRatio;enemy.maxHp*=hpRatio;enemy.damage*=damageRatio;}text=`Угроза установлена: ${threatLabel(target)}`;}
      else if(command==='mapcheck'){if(state.map!=='obstacles'||!obstacles.length){text='Карта ОБЫЧНАЯ · препятствий нет';return;}const obstacle=obstacles[0],probe={x:obstacle.x-obstacle.hx-1,z:obstacle.z},pointOk=pointBlockedByObstacle(obstacle.x,obstacle.z,.2),lineOk=lineBlockedByObstacle(obstacle.x-obstacle.hx-2,obstacle.z,obstacle.x+obstacle.hx+2,obstacle.z,.08),before=obstacles.length;moveWithObstacles(probe,obstacle.hx*2+2,0,.4);const movementOk=probe.x<obstacle.x-obstacle.hx+.05;ensureMapObstacles(player.x+180,player.z,true);const expansionOk=obstacles.length>before;if(!pointOk||!lineOk||!movementOk||!expansionOk)throw Error(`Ошибка карты · точка ${pointOk} · линия ${lineOk} · движение ${movementOk} · расширение ${expansionOk}`);text=`Карта С ПРЕПЯТСТВИЯМИ · объектов ${obstacles.length} · движение OK · линии огня OK · расширение OK`;}
      else if(command==='enemies'&&tokens[1]?.toLowerCase()==='clear'){const count=enemies.length;enemies=[];activeStandards=[];enemyProjectiles=[];text=`Удалено врагов: ${count}`;}
      else if(command==='status')text=`${actor.name} · ${HEROES[state.hero]?.name||state.hero} · HP ${Math.ceil(s.hp)}/${Math.ceil(s.maxHp)} · уровень ${s.level} · ожид. ${Math.round(state.adaptive?.expectedLevel||1)} · адаптация HP ×${(state.adaptive?.health||1).toFixed(2)} / урон ×${(state.adaptive?.damage||1).toFixed(2)} · время ${formatTime(state.time)}/${formatTime(runDuration())} · ${state.runPace==='rush'?'УСКОРЕННЫЙ':'СТАНДАРТ'} · карта ${state.map==='obstacles'?'С ПРЕПЯТСТВИЯМИ':'ОБЫЧНАЯ'} · угроза ${threatLabel(state.threatTier)}${state.endless?' · РАЗЛОМ':''} · врагов ${enemies.length} · спутников ${heroUnits.length} · god ${actor.debugGod?'ON':'OFF'}`;
      else if(command==='kill'){s.revives=0;s.hp=0;endGame(false);text='Забег завершён поражением';}
      else if(command==='win'){endGame(true);text='Забег завершён победой';}
      else if(command==='weapons')text=Object.keys(state.weapons).join(', ');
      else if(command==='items')text=upgrades.map(item=>item.id).join(', ');
      else if(command==='enemies')text=Object.keys(ENEMY_TYPES).join(', ');
      else throw Error(`Неизвестная команда: ${command}. Введите help`);
    });if(actor?.local){updateSlots();updateUI(true);}return{ok:true,text};}catch(error){return{ok:false,text:error.message||String(error)};
    }
  }
  function submitDevCommand(raw){const line=raw.trim();if(!line)return;consoleLine(line,'command');devHistory.push(line);if(devHistory.length>80)devHistory.shift();devHistoryIndex=devHistory.length;if(line.toLowerCase()==='clear'){devLog.innerHTML='';return;}if(coopNet.mode==='guest'&&!['help','?'].includes(line.toLowerCase())){sendCoop({type:'debug',line});consoleLine('Команда отправлена хосту…','info');return;}const actor=coopActors.find(item=>item.local)||coopActors[0],result=executeDebugCommand(line,actor);consoleLine(result.text,result.ok?'ok':'error');}
  $('#devConsoleForm').addEventListener('submit',event=>{event.preventDefault();const value=devInput.value;devInput.value='';submitDevCommand(value);});
  devInput.addEventListener('keydown',event=>{if(event.code==='ArrowUp'){event.preventDefault();devHistoryIndex=Math.max(0,devHistoryIndex-1);devInput.value=devHistory[devHistoryIndex]||'';devInput.setSelectionRange(devInput.value.length,devInput.value.length);}else if(event.code==='ArrowDown'){event.preventDefault();devHistoryIndex=Math.min(devHistory.length,devHistoryIndex+1);devInput.value=devHistory[devHistoryIndex]||'';}});
  $('#coopBtn')?.addEventListener('click',openCoopModal);$('#coopCloseBtn').addEventListener('click',closeCoopModal);coopModal.addEventListener('click',event=>{if(event.target===coopModal)closeCoopModal();});
  $('#coopHostBtn').addEventListener('click',()=>connectCoop('host'));$('#coopJoinBtn').addEventListener('click',()=>{const room=$('#coopRoomInput').value.trim().toUpperCase();if(room.length<4){coopStatus('Введите код комнаты',true);return;}connectCoop('guest',room);});$('#coopStartBtn').addEventListener('click',startCoopHost);
  addEventListener('keydown',e=>{
    if(e.code==='Backquote'){e.preventDefault();toggleDevConsole();return;}
    if(!devConsole.classList.contains('hidden')){if(e.code==='Escape'){e.preventDefault();toggleDevConsole(false);}return;}
    if(!codexModal.classList.contains('hidden')){if(e.code==='Escape'){e.preventDefault();closeCodex();}return;}
    if(!customModal.classList.contains('hidden')){if(e.code==='Escape')closeCustomDifficulty();return;}
    if(!coopModal.classList.contains('hidden')){if(e.code==='Escape')closeCoopModal();return;}
    if(e.code==='Escape'&&state.mode==='menu'&&menuPage!=='home'){e.preventDefault();menuBack();return;}
    if(e.code==='Tab'){e.preventDefault();toggleBuildInspector();return;}
    if(e.code==='Escape'&&!$('#buildInspector').classList.contains('hidden')){e.preventDefault();toggleBuildInspector(false);return;}
    if(e.code==='KeyV'&&['playing','paused','remote'].includes(state.mode)){e.preventDefault();setCameraMode(isFirstPerson()?'overhead':'first');return;}
    keys[e.code]=true;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
    if(e.code==='Enter'&&state.mode==='menu'){e.preventDefault();handleMenuEnter();return;}
    if(e.code==='Escape'&&(state.mode==='playing'||state.mode==='paused'||state.mode==='remote'))pauseToggle();
    if(isCoop()&&['Digit1','Digit2','Digit3','Numpad1','Numpad2','Numpad3'].includes(e.code)){const index=Number(e.code.at(-1))-1;if(coopNet.mode==='guest')sendGuestChoice(index);else pickCompactChoice(index);}
    if(state.mode==='choice'&&['Digit1','Digit2','Digit3','Digit4','Numpad1','Numpad2','Numpad3','Numpad4'].includes(e.code))pickChoice(Number(e.code.at(-1))-1);
  });
  addEventListener('keyup',e=>keys[e.code]=false);
  addEventListener('mousemove',e=>{if(!isFirstPerson()||document.pointerLockElement!==canvas)return;cameraYaw=(cameraYaw+e.movementX*.0022)%TAU;cameraPitch=clamp(cameraPitch-e.movementY*.0018,-.55,.45);const actor=coopActors.find(item=>item.local);if(actor){actor.firstPerson=true;actor.aimYaw=cameraYaw;actor.aimPitch=cameraPitch;}syncCameraUI();});
  canvas.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'||event.button!==0||!['playing','remote'].includes(state.mode)||lastViewFirstPerson)return;const target=enemyAtScreen(event.clientX,event.clientY);if(target){event.preventDefault();setLocalTarget(target)}});
  canvas.addEventListener('contextmenu',event=>{if(!['playing','remote'].includes(state.mode))return;event.preventDefault();clearLocalTarget(true)});
  canvas.addEventListener('click',()=>{if(isFirstPerson())requestCameraPointerLock();});
  document.addEventListener('pointerlockchange',()=>document.body.classList.toggle('camera-unlocked',isFirstPerson()&&document.pointerLockElement!==canvas));
  addEventListener('blur',()=>{keys={};resetFloatingStick();if(state.mode==='playing'&&!isCoop())pauseToggle();});
  const MENU_PARENTS={mode:'home',map:'mode',hero:'map',run:'hero',settings:'home'};
  function syncMenuSummary(){
    const difficultyNames={normal:'ОБЫЧНАЯ',hardcore:'ХАРДКОР',custom:'КАСТОМНАЯ'},mapNames={normal:'ОБЫЧНАЯ',obstacles:'С ПРЕПЯТСТВИЯМИ'};
    if($('#menuSummaryHero'))$('#menuSummaryHero').textContent=HEROES[selectedHero]?.name||selectedHero.toUpperCase();
    if($('#menuSummaryPace'))$('#menuSummaryPace').textContent=selectedRunPace==='rush'?'10 МИНУТ':'30 МИНУТ';
    if($('#menuSummaryDifficulty'))$('#menuSummaryDifficulty').textContent=difficultyNames[selectedDifficulty]||selectedDifficulty.toUpperCase();
    if($('#menuSummaryGraphics'))$('#menuSummaryGraphics').textContent=selectedGraphics==='rtx'?'RTX EDITION':'ОБЫЧНАЯ';
    if($('#menuSummaryMap'))$('#menuSummaryMap').textContent=mapNames[selectedMap]||'ОБЫЧНАЯ';
  }
  function showMenuPage(page,direction='forward',sound=true){
    const target=$(`[data-menu-page="${page}"]`);if(!target)return;menuPage=page;const shell=$('#menuShell');shell.dataset.menuDirection=direction;
    $$('.menu-page').forEach(section=>{const active=section===target;section.classList.toggle('active',active);section.setAttribute('aria-hidden',String(!active));});
    syncMenuSummary();if(sound){audio.init();audio.tone(direction==='back'?250:430,.075,'triangle',.018);}setTimeout(()=>target.querySelector('button:not([disabled]),select,input')?.focus(),40);
  }
  function menuBack(){showMenuPage(MENU_PARENTS[menuPage]||'home','back');}
  function handleMenuEnter(){
    if(menuPage==='home'){showMenuPage('mode');return;}if(menuPage==='mode'){showMenuPage('map');return;}if(menuPage==='map'){showMenuPage('hero');return;}if(menuPage==='hero'){showMenuPage('run');return;}if(menuPage==='settings'){showMenuPage('home','back');return;}
    selectedSeed=normalizeSeed($('#runSeedInput').value)||selectedSeed;persistChallenge();startGame();
  }
  $$('[data-menu-go]').forEach(button=>button.addEventListener('click',()=>showMenuPage(button.dataset.menuGo)));
  $$('[data-menu-back]').forEach(button=>button.addEventListener('click',menuBack));
  $$('.hero-card').forEach(card=>card.addEventListener('click',()=>{selectedHero=card.dataset.hero;$$('.hero-card').forEach(c=>c.classList.toggle('selected',c===card));syncMenuSummary();audio.init();audio.tone(300,.05,'triangle',.02);if(card.dataset.menuNext)setTimeout(()=>showMenuPage(card.dataset.menuNext),90);}));
  $$('.difficulty-option').forEach(option=>option.addEventListener('click',()=>option.dataset.difficulty==='custom'?openCustomDifficulty():selectDifficulty(option.dataset.difficulty)));
  function selectRunPace(mode,sound=true){selectedRunPace=RUN_PACES[mode]?mode:'standard';$$('.pace-option').forEach(option=>option.classList.toggle('selected',option.dataset.pace===selectedRunPace));try{localStorage.setItem('riftRunPace',selectedRunPace)}catch(_error){}loadBest();if(sound){audio.init();audio.tone(selectedRunPace==='rush'?690:360,.12,'triangle',.028);}}
  $$('.pace-option').forEach(option=>option.addEventListener('click',()=>{selectRunPace(option.dataset.pace);syncMenuSummary();if(option.dataset.menuNext)setTimeout(()=>showMenuPage(option.dataset.menuNext),90);}));
  function selectMap(mode,sound=true){selectedMap=mode==='obstacles'?'obstacles':'normal';$$('.map-option').forEach(option=>option.classList.toggle('selected',option.dataset.map===selectedMap));try{localStorage.setItem('riftMap',selectedMap)}catch(_error){}syncMenuSummary();if(sound){audio.init();audio.tone(selectedMap==='obstacles'?510:350,.11,'triangle',.025);}}
  $$('.map-option').forEach(option=>option.addEventListener('click',()=>{selectMap(option.dataset.map);if(option.dataset.menuNext)setTimeout(()=>showMenuPage(option.dataset.menuNext),90);}));
  function persistChallenge(){try{localStorage.setItem('riftChallenge',selectedChallenge);localStorage.setItem('riftSeed',selectedSeed);}catch(_error){}}
  function syncChallengeMenu(){if(!CHALLENGES[selectedChallenge])selectedChallenge='classic';if(!selectedSeed)selectedSeed=randomSeed();$('#challengeSelect').value=selectedChallenge;$('#runSeedInput').value=selectedSeed;$('#challengeDesc').textContent=CHALLENGES[selectedChallenge].desc;persistChallenge();}
  $('#challengeSelect').addEventListener('change',event=>{selectedChallenge=CHALLENGES[event.target.value]?event.target.value:'classic';syncChallengeMenu();audio.init();audio.tone(selectedChallenge==='bossrush'?95:470,.13,'triangle',.026);});
  $('#runSeedInput').addEventListener('input',event=>{const cursor=event.target.selectionStart;event.target.value=normalizeSeed(event.target.value);event.target.setSelectionRange(cursor,cursor);});
  $('#runSeedInput').addEventListener('change',event=>{selectedSeed=normalizeSeed(event.target.value)||randomSeed();syncChallengeMenu();});
  $('#randomSeedBtn').addEventListener('click',()=>{selectedSeed=randomSeed();syncChallengeMenu();audio.init();audio.tone(620,.08,'square',.02);});
  function selectGraphics(mode,sound=true){selectedGraphics=mode==='rtx'?'rtx':'normal';$$('.graphics-option').forEach(e=>e.classList.toggle('selected',e.dataset.graphics===selectedGraphics));document.body.classList.toggle('rtx-mode',selectedGraphics==='rtx');try{localStorage.setItem('riftGraphics',selectedGraphics)}catch(_error){}syncMenuSummary();if(sound){audio.init();audio.tone(selectedGraphics==='rtx'?520:280,.12,'triangle',.025);}}
  $$('.graphics-option').forEach(option=>option.addEventListener('click',()=>selectGraphics(option.dataset.graphics)));
  $('#renderScaleInput').addEventListener('input',event=>setRenderScale(Number(event.currentTarget.value)/100));
  $('#startBtn').addEventListener('click',()=>{selectedSeed=normalizeSeed($('#runSeedInput').value)||selectedSeed;persistChallenge();startGame();});$('#resumeBtn').addEventListener('click',pauseToggle);$('#continueEndlessBtn').addEventListener('click',()=>enterEndless());$('#restartBtn').addEventListener('click',startGame);$('#restartBtnPause').addEventListener('click',startGame);$('#menuBtnPause').addEventListener('click',returnMenu);$('#menuBtnEnd').addEventListener('click',returnMenu);$('#buildInspectorClose').addEventListener('click',()=>toggleBuildInspector(false));$('#downloadBalancePng').addEventListener('click',downloadBalancePng);$('#downloadBalanceJson').addEventListener('click',downloadBalanceJson);

  const stick=$('#mobileStick'),nub=stick.firstElementChild,FLOATING_STICK_RADIUS=42,FLOATING_STICK_DEAD_ZONE=4;
  let floatingStickPointer=null,floatingStickX=0,floatingStickY=0;
  function syncFloatingStickDebug(active){canvas.dataset.mobileStickActive=String(active);canvas.dataset.mobileInputX=touchMove.x.toFixed(3);canvas.dataset.mobileInputZ=touchMove.z.toFixed(3);}
  function floatingStickBlockedTarget(target){return Boolean(target?.closest?.('button,a,input,select,textarea,label,[role="button"],[contenteditable="true"],.overlay,.menu,.dev-console,.build-inspector,.coop-choice-panel'))}
  function startFloatingStick(event){
    if(event.pointerType!=='touch'||floatingStickPointer!==null||!['playing','remote'].includes(state.mode)||floatingStickBlockedTarget(event.target))return;
    floatingStickPointer=event.pointerId;floatingStickX=event.clientX;floatingStickY=event.clientY;touchMove={x:0,z:0};document.body.classList.add('touch-input');stick.style.left=`${floatingStickX}px`;stick.style.top=`${floatingStickY}px`;stick.classList.add('active');nub.style.transform='translate(0px,0px)';syncFloatingStickDebug(true);event.preventDefault();
  }
  function moveFloatingStick(event){
    if(event.pointerId!==floatingStickPointer)return;const dx=event.clientX-floatingStickX,dy=event.clientY-floatingStickY,distance=Math.hypot(dx,dy),nx=distance?dx/distance:0,ny=distance?dy/distance:0,knobDistance=Math.min(FLOATING_STICK_RADIUS,distance),strength=clamp((distance-FLOATING_STICK_DEAD_ZONE)/(FLOATING_STICK_RADIUS-FLOATING_STICK_DEAD_ZONE),0,1);touchMove={x:nx*strength,z:ny*strength};nub.style.transform=`translate(${(nx*knobDistance).toFixed(1)}px,${(ny*knobDistance).toFixed(1)}px)`;syncFloatingStickDebug(true);event.preventDefault();
  }
  function resetFloatingStick(event){
    if(event&&floatingStickPointer!==null&&event.pointerId!==floatingStickPointer)return;floatingStickPointer=null;touchMove={x:0,z:0};stick.classList.remove('active');nub.style.transform='translate(0px,0px)';syncFloatingStickDebug(false);
  }
  addEventListener('pointerdown',startFloatingStick,{passive:false});addEventListener('pointermove',moveFloatingStick,{passive:false});addEventListener('pointerup',resetFloatingStick,{passive:false});addEventListener('pointercancel',resetFloatingStick,{passive:false});syncFloatingStickDebug(false);

  canvas.dataset.telemetry=TELEMETRY_ENABLED?'on':'off';setRenderScale(renderScale,false);syncChallengeMenu();selectRunPace(selectedRunPace,false);selectMap(selectedMap,false);selectGraphics(selectedGraphics,false);syncMenuSummary();showMenuPage('home','forward',false);loadBest();requestAnimationFrame(loop);
})();
