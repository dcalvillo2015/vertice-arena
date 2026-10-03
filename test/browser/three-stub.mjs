// Sustituto mínimo de Three.js para pruebas sin GPU ni acceso a la CDN.
// Cualquier propiedad/llamada devuelve otro proxy; los valores asignados se conservan.
const handler = {
  get(t, p) {
    if (p === Symbol.toPrimitive) return () => 0;
    if (p === 'then') return undefined;
    if (p === Symbol.iterator) return function* () {};
    if (p in t) return t[p];
    const v = make();
    t[p] = v;
    return v;
  },
  set(t, p, v) { t[p] = v; return true; },
  apply() { return make(); },
  construct(t, args) {
    const o = make();
    if (t.__name === 'WebGLRenderer') o.domElement = document.createElement('canvas');
    if (t.__name === 'Vector3') { o.x = args[0] || 0; o.y = args[1] || 0; o.z = args[2] || 0; }
    return o;
  },
};
function make(name) { const f = function () {}; f.__name = name; return new Proxy(f, handler); }
const names = ['Scene','Color','Fog','HemisphereLight','DirectionalLight','Mesh','PlaneGeometry','MeshStandardMaterial','MeshLambertMaterial','BoxGeometry','InstancedMesh','Matrix4','Quaternion','Vector3','Vector2','RingGeometry','MeshBasicMaterial','CanvasTexture','Group','Sprite','SpriteMaterial','PerspectiveCamera','CylinderGeometry','BufferGeometry','BufferAttribute','Points','PointsMaterial','PointLight','Object3D','WebGLRenderer'];
const S = {};
for (const n of names) S[n] = make(n);
export const { Scene, Color, Fog, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry, MeshStandardMaterial, MeshLambertMaterial, BoxGeometry, InstancedMesh, Matrix4, Quaternion, Vector3, Vector2, RingGeometry, MeshBasicMaterial, CanvasTexture, Group, Sprite, SpriteMaterial, PerspectiveCamera, CylinderGeometry, BufferGeometry, BufferAttribute, Points, PointsMaterial, PointLight, Object3D, WebGLRenderer } = S;
export const SRGBColorSpace = 'srgb', RepeatWrapping = 1000, AdditiveBlending = 2, DynamicDrawUsage = 35048, PCFSoftShadowMap = 2, ACESFilmicToneMapping = 4;
