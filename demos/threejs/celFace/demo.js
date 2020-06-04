"use strict";

// SETTINGS of this demo:
const SETTINGS = {
  rotationOffsetX: 0, // negative -> look upper. in radians
  cameraFOV: 40,    // in degrees, 3D camera FOV
  pivotOffsetYZ: [0.2,0.0], // XYZ of the distance between the center of the cube and the pivot
  detectionThreshold: 0.75, // sensibility, between 0 and 1. Less -> more sensitive
  detectionHysteresis: 0.05,
  scale: 1.1, // scale of the 3D cube
  blurEdgeSoftness: 10
};

// global THREE objects:
let THREEVIDEOTEXTURE = null;
let THREERENDERER = null;
let THREEFACEOBJ3D = null;
let THREEFACEOBJ3DPIVOTED = null;
let THREESCENE = null;
let THREECAMERA = null;
let THREESCENE0 = null;
let THREESCENE0RENDERTARGET = null;
let THREESCENE1 = null;
let THREESCENE1RENDERTARGET = null;
let THREESCENE2 = null;
let THREESCENE2RENDERTARGET = null;
let CANVAS_CTX = null;
// global initilialized by JEEFACEFILTER:
let GL = null, GLVIDEOTEXTURE = null;
let _3DMODEL = null
// other globalz:
let ISDETECTED = false;
const BACKGROUNDTEXTURE = new THREE.TextureLoader().load( "textures/natural2.jpg" );
BACKGROUNDTEXTURE.flipY = true;
const BODYTEXTURE = new THREE.TextureLoader().load( "textures/body2.png" );
//BACKGROUNDTEXTURE.encoding = THREE.sRGBEncoding;
BACKGROUNDTEXTURE.flipY = false;
//BACKGROUNDTEXTURE.wrapS = THREE.RepeatWrapping;
//BACKGROUNDTEXTURE.wrapT = THREE.RepeatWrapping;

var BODYMATERIAL = new THREE.MeshBasicMaterial( {
  map: BODYTEXTURE,
  color: new THREE.Color( 0xff00ff ),
  depthTest: false,
  depthWrite: true,
  transparent: true,
 // alphaMap: BODYTEXTURE,
} );
BODYMATERIAL.frustumCulled = false;
let BODYMESH = null;

const BACKGROUNDMATERIAL = new THREE.MeshBasicMaterial( {
  map: BACKGROUNDTEXTURE,
  color: new THREE.Color( 0xffffff ),
  //transparent: true,
  //depthTest: false,
 // depthWrite: true,
  blending: THREE.NormalBlending,
});
 // alphaMap

const width = 2048
const height = 1024
var data = new Uint8Array( width * height * 4 );
let BG_BODY_TEXTURE; // = new THREE.TextureLoader().load( "textures/natural2.jpg" );;



// callback: launched if a face is detected or lost
function detect_callback(isDetected) {
  if (isDetected) {
    console.log('INFO in detect_callback(): DETECTED');
  } else {
    console.log('INFO in detect_callback(): LOST');
  }
}


function get_mat2DshaderSource() {
  return "attribute vec2 position;\n\
      varying vec2 vUV;\n\
      void main(void){\n\
        gl_Position = vec4(position,0.,1.);\n\
        vUV = 0.5 + 0.5*position;\n\
      }";
}

function build_videoMaterial(blurredAlphaTexture) {
  const mat = new THREE.RawShaderMaterial({
    depthWrite: true,
    depthTest: false,
    transparent: true,
    vertexShader: get_mat2DshaderSource(),
    fragmentShader: "precision lowp float;\n\
      uniform sampler2D samplerVideo, backgroundVideo, samplerBlurredAlphaFace;\n\
      varying vec2 vUV;\n\
      const vec4 FACECOLOR=vec4(0.0, 0.0, 255.0, 0.0)/255.0;\n\
      void main(void){\n\
        vec3 videoColor=texture2D(samplerVideo, vUV).rgb;\n\
        vec4 videoColorA=vec4(videoColor, 1);\n\
        vec3 backgroundColor=texture2D(backgroundVideo, vUV).rgb;\n\
        vec4 faceColor=texture2D(samplerBlurredAlphaFace, vUV);\n\
        // apply some tweaks to faceColor:\n\
        vec4 mixedColor = mix(videoColorA, FACECOLOR.rgba, 1. - faceColor.a);\n\
        gl_FragColor = mixedColor;\n\
        //gl_FragColor.a = 0.0;\n\
      }",
    uniforms: {
      backgroundVideo: { value: BG_BODY_TEXTURE },
      samplerVideo: { value: THREEVIDEOTEXTURE },
      samplerBlurredAlphaFace: { value: blurredAlphaTexture }
    }
  });
  return mat;
} // end build_videoMaterial()

function build_maskMaterial(fragmentShaderSource, videoDimensions) {
  const vertexShaderSource = 'varying vec2 vUVvideo;\n\
  void main() {\n\
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );\n\
    vec4 projectedPosition = projectionMatrix * mvPosition;\n\
    gl_Position = projectedPosition;\n\
    // compute UV coordinates on the video texture:\n\
    vUVvideo = vec2(0.5,0.5)+0.5*projectedPosition.xy/projectedPosition.w;\n\
  }';

  const mat = new THREE.ShaderMaterial({
    vertexShader: vertexShaderSource,
    fragmentShader: fragmentShaderSource,
    uniforms: {
      samplerVideo: { value: THREEVIDEOTEXTURE },
      videoSize: { value: new THREE.Vector2().fromArray(videoDimensions) }
    }
  });
  return mat;
} // end build_maskMaterial()

function build_blurMaterial(dxy, threeTexture) {
  const mat = new THREE.RawShaderMaterial({
    depthWrite: false,
    depthTest: false,
    vertexShader: get_mat2DshaderSource(),
    fragmentShader: "precision lowp float;\n\
      uniform sampler2D samplerImage;\n\
      uniform vec2 dxy;\n\
      varying vec2 vUV;\n\
      void main(void){\n\
        vec4 colCenter = texture2D(samplerImage, vUV);\n\
        gl_FragColor = colCenter;\n\
      }",
    uniforms: {
      samplerImage:{ value: threeTexture },
      dxy: { value: new THREE.Vector2().fromArray(dxy).multiplyScalar(SETTINGS.blurEdgeSoftness) }
    }
  });
  return mat;
} // end build_blurMaterial()

// build the 3D. called once when Jeeliz Face Filter is OK
function init_threeScene(spec) {
  // AFFECT GLOBALS:
  GL = spec.GL;
  GLVIDEOTEXTURE = spec.videoTexture;

  // INIT THE THREE.JS context
  THREERENDERER = new THREE.WebGLRenderer({
    context: spec.GL,
    canvas: spec.canvasElement
  });
  
  BG_BODY_TEXTURE = new THREE.DataTexture( data, width, height, THREE.RGBAFormat );
  BG_BODY_TEXTURE.encoding = THREE.sRGBEncoding;
  BG_BODY_TEXTURE.flipY = false;
  BG_BODY_TEXTURE.wrapS = THREE.RepeatWrapping;
  BG_BODY_TEXTURE.wrapT = THREE.RepeatWrapping;
  
  //THREERENDERER.setSize( window.innerWidth, window.innerHeight );
  // CREATE THE SCENES
  THREESCENE = new THREE.Scene();
  THREESCENE0 = new THREE.Scene();
  THREESCENE1 = new THREE.Scene();
  THREESCENE2 = new THREE.Scene();
  
  // CREATE THE TARGET TEXTURES FOR RENDER TO TEXTURE
  const filters = {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false
  };
  THREESCENE0RENDERTARGET = new THREE.WebGLRenderTarget(spec.canvasElement.width, spec.canvasElement.height, filters);
  THREESCENE1RENDERTARGET = new THREE.WebGLRenderTarget(spec.canvasElement.width, spec.canvasElement.height, filters);
  THREESCENE2RENDERTARGET = new THREE.WebGLRenderTarget(spec.canvasElement.width, spec.canvasElement.height, filters);
  
  // init video texture with red
  THREEVIDEOTEXTURE = new THREE.DataTexture(new Uint8Array([255,0,0]), 1, 1, THREE.RGBFormat);
  THREEVIDEOTEXTURE.needsUpdate = true;

  // INIT THE THREE.JS LOADING MANAGER
  const _threeLoadingManager = new THREE.LoadingManager();

  // COMPOSITE OBJECT WHICH WILL FOLLOW THE HEAD
  // in fact we create 2 objects to be able to shift the pivot point
  THREEFACEOBJ3D = new THREE.Object3D();
  THREEFACEOBJ3D.frustumCulled = false;
  THREEFACEOBJ3DPIVOTED = new THREE.Object3D();
  THREEFACEOBJ3DPIVOTED.frustumCulled = false;
  THREEFACEOBJ3DPIVOTED.position.set(0, -SETTINGS.pivotOffsetYZ[0], -SETTINGS.pivotOffsetYZ[1]);
  THREEFACEOBJ3DPIVOTED.scale.set(SETTINGS.scale, SETTINGS.scale, SETTINGS.scale);
  THREEFACEOBJ3D.add(THREEFACEOBJ3DPIVOTED);
  THREESCENE0.add(THREEFACEOBJ3D);

  // REATE THE MASK
  const maskLoader = new THREE.BufferGeometryLoader(_threeLoadingManager);
  let _maskBufferGeometry = null, _maskMaterial = null;
  /*
  faceLowPoly.json has been exported from dev/faceLowPoly.blend using THREE.JS blender exporter with Blender v2.76
  */
  maskLoader.load('./models/faceLowPoly.json', function (maskBufferGeometry) {
    maskBufferGeometry.computeVertexNormals();
    _maskBufferGeometry = maskBufferGeometry;
  });
  const celFragmentShaderLoader = new THREE.FileLoader(_threeLoadingManager);
  celFragmentShaderLoader.load('./shaders/celFragmentShader.gl', function (fragmentShaderSource) {
    _maskMaterial = build_maskMaterial(fragmentShaderSource, [spec.canvasElement.width, spec.canvasElement.height]);
  });
  _threeLoadingManager.onLoad = function () {
    console.log('INFO in demo_celFace.js: all 3D assets have been loaded successfully :)');
    const threeMask = new THREE.Mesh(_maskBufferGeometry, _maskMaterial);
    threeMask.frustumCulled = false;
    threeMask.scale.multiplyScalar(1.2);
    threeMask.position.set(0, 0.2, -0.5);
    THREEFACEOBJ3DPIVOTED.add(threeMask);
  }
  
  // CREATE THE VIDEO BACKGROUND
  const _quad2DGeometry = new THREE.BufferGeometry()
  const videoScreenCorners = new Float32Array([-1,-1, -2.0,  1,-1,-2.0,   1,1,-2.0,   -1,1,-2.0]);
  _quad2DGeometry.addAttribute('position', new THREE.BufferAttribute( videoScreenCorners, 3));
  _quad2DGeometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0,1,2, 0,2,3]), 1));
  const _videoMaterial = build_videoMaterial(THREESCENE2RENDERTARGET.texture);
  const videoMesh = new THREE.Mesh(_quad2DGeometry, _videoMaterial);
  videoMesh.frustumCulled = false;
  videoMesh.transparent = true;
  //videoMesh.depthWrite = true;
  //videoMesh.depthWrite = true;
  
  videoMesh.onAfterRender = function () {
    THREERENDERER.properties.update(THREEVIDEOTEXTURE, '__webglTexture', GLVIDEOTEXTURE);
    THREEVIDEOTEXTURE.magFilter = THREE.LinearFilter;
    THREEVIDEOTEXTURE.minFilter = THREE.LinearFilter;
    delete(videoMesh.onAfterRender);
  }
  THREESCENE.add(videoMesh);
  
  // THREESCENE.add(videoMesh);
  

  // CREATE THE VIDEO BACKGROUND
  //THREESCENE.add(videoMesh);
  
  //THREESCENE.add(BODYMESH);

var backgroundGeometry = new THREE.BoxBufferGeometry( 10, 10, 0.02 );
var bg = new THREE.Mesh( backgroundGeometry, BACKGROUNDMATERIAL );
bg.frustumCulled = false;
THREESCENE.add( bg );
bg.position.z = -10;
//cube.renderOrder = 3;    
//videoMesh.renderOrder = 2;


var geometry2 = new THREE.BoxBufferGeometry( 4, 4, 0.01 );
var cube = new THREE.Mesh( geometry2, BODYMATERIAL );
cube.frustumCulled = false;
THREESCENE.add( cube );
bg.renderOrder = 1;
cube.renderOrder = 5;    
videoMesh.renderOrder = 6;
BODYMESH=cube;
BODYMESH.magFilter = THREE.LinearFilter;
BODYMESH.minFilter = THREE.LinearFilter;

//cube.position.set(0,0,-5);

  // INIT STUFFS FOR THE SECOND PASS:
  const faceBlurAlphaXmesh = new THREE.Mesh(_quad2DGeometry, build_blurMaterial([1 / spec.canvasElement.width, 0], THREESCENE0RENDERTARGET.texture));
  const faceBlurAlphaYmesh = new THREE.Mesh(_quad2DGeometry, build_blurMaterial([0, 1 / spec.canvasElement.height], THREESCENE1RENDERTARGET.texture));
  faceBlurAlphaXmesh.frustumCulled = false;
  faceBlurAlphaYmesh.frustumCulled = false;
  THREESCENE1.add(faceBlurAlphaXmesh);
  THREESCENE2.add(faceBlurAlphaYmesh);


  // CREATE THE CAMERA:
  const aspecRatio = spec.canvasElement.width / spec.canvasElement.height;
  THREECAMERA = new THREE.PerspectiveCamera(SETTINGS.cameraFOV, aspecRatio, 0.1, 100);
  THREECAMERA.position.z = 0;
  CANVAS_CTX = spec.canvasElement.getContext('webgl');
} // end init_threeScene()

// entry point:
function main(){
  JeelizResizer.size_canvas({
    canvasId: 'jeeFaceFilterCanvas',
    callback: function(isError, bestVideoSettings){
      init_faceFilter(bestVideoSettings);
    }
  })
} //end main()

function init_faceFilter(videoSettings){
  JEEFACEFILTERAPI.init({
    canvasId: 'jeeFaceFilterCanvas',
    NNCpath: '../../../dist/', // root of NNC.json file
    videoSettings: videoSettings,
    callbackReady: function (errCode, spec) {
      if (errCode) {
        console.log('AN ERROR HAPPENS. SORRY BRO :( . ERR =', errCode);
        return;
      }

      console.log('INFO: JEEFACEFILTERAPI IS READY');
      init_threeScene(spec);
    },

    // called at each render iteration (drawing loop)
    callbackTrack: function (detectState) {
      if (ISDETECTED && detectState.detected < SETTINGS.detectionThreshold - SETTINGS.detectionHysteresis) {
        // DETECTION LOST
        detect_callback(false);
        ISDETECTED = false;
      } else if (!ISDETECTED && detectState.detected > SETTINGS.detectionThreshold + SETTINGS.detectionHysteresis) {
        // FACE DETECTED
        detect_callback(true);
        ISDETECTED = true;
      }

      if (ISDETECTED) {
        //CANVAS_CTX.clearColor(255,0,0,1);
        // move the cube in order to fit the head
        const tanFOV = Math.tan(THREECAMERA.aspect * THREECAMERA.fov * Math.PI / 360); // tan(FOV/2), in radians
        const W = detectState.s;  // relative width of the detection window (1-> whole width of the detection window)
        const D = 1 / (2 * W * tanFOV); // distance between the front face of the cube and the camera
        
        // coords in 2D of the center of the detection window in the viewport:
        const xv = detectState.x;
        const yv = detectState.y;
        
        //coords in 3D of the center of the cube (in the view coordinates system)
        const z = -D - 0.5;   // minus because view coordinate system Z goes backward. -0.5 because z is the coord of the center of the cube (not the front face)
        const x = xv * D * tanFOV;
        const y = yv * D * tanFOV / THREECAMERA.aspect;

        // move and rotate the cube
        THREEFACEOBJ3D.position.set(x, y + SETTINGS.pivotOffsetYZ[0], z + SETTINGS.pivotOffsetYZ[1]);
        THREEFACEOBJ3D.rotation.set(detectState.rx + SETTINGS.rotationOffsetX, detectState.ry, detectState.rz, "XYZ");
      
        //BODYMESH.position.set(x, -1.2 + SETTINGS.pivotOffsetYZ[0], z + SETTINGS.pivotOffsetYZ[1]);
        BODYMESH.position.set(x + .1, y - 1.2 +  SETTINGS.pivotOffsetYZ[0] - 1.4,
          z + SETTINGS.pivotOffsetYZ[1]
          );
       
     
      THREERENDERER.state.reset();
      
      THREERENDERER.setRenderTarget(THREESCENE0RENDERTARGET)
      // first render to texture: 3D face  mask with cel shading
      THREERENDERER.render(THREESCENE0, THREECAMERA);
      THREERENDERER.setRenderTarget(THREESCENE1RENDERTARGET)
      
      // second pass: add gaussian blur on alpha channel horizontally
      THREERENDERER.render(THREESCENE1, THREECAMERA);
      THREERENDERER.setRenderTarget(THREESCENE2RENDERTARGET)
      
      // second pass: add gaussian blur on alpha channel vertically
      THREERENDERER.render(THREESCENE2, THREECAMERA);

      //debugger;
      //THREERENDERER.copyTextureToTexture(new THREE.Vector2(0,0), BACKGROUNDTEXTURE, BG_BODY_TEXTURE);
     // THREERENDERER.copyTextureToTexture(new THREE.Vector2(0,0), BODYTEXTURE, BG_BODY_TEXTURE, 0);
     /*THREERENDERER.copyTextureToTexture(new THREE.Vector2(0,0), BACKGROUNDTEXTURE, BG_BODY_TEXTURE);
     //THREERENDERER.copyTextureToTexture(new THREE.Vector2(0,0), BODYTEXTURE, BG_BODY_TEXTURE);
     BODYTEXTURE.flipY = true;
     THREERENDERER.copyTextureToTexture(
       new THREE.Vector2(
       // (0 + BODYTEXTURE.image.width / BG_BODY_TEXTURE.image.width / 2 ) * (BG_BODY_TEXTURE.image.width),
    BODYTEXTURE.image.width / BG_BODY_TEXTURE.image.width,  
    //  x * BG_BODY_TEXTURE.image.width + BODYTEXTURE.image.width/2,
         y * BG_BODY_TEXTURE.image.height - SETTINGS.pivotOffsetYZ[0] *  BG_BODY_TEXTURE.image.height ), BODYTEXTURE, BG_BODY_TEXTURE);
     BG_BODY_TEXTURE.flipY = false;
     */
      //videoMesh.position.set(0.5, .5, 0);
      THREERENDERER.setRenderTarget(null)
      
      THREERENDERER.render(THREESCENE, THREECAMERA);
    }

      // THREECAMERA.position.z = THREECAMERA.position.z - 0.01
    } // end callbackTrack()
  }); // end JEEFACEFILTERAPI.init call
} // end main()

