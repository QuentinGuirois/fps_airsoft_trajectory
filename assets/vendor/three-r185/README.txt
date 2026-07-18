Three.js r185.1 (npm package three@0.185.1)
Source: https://registry.npmjs.org/three/-/three-0.185.1.tgz
Upstream: https://github.com/mrdoob/three.js/tree/r185

Static files retained for F.A.T.:
- build/three.module.min.js
- build/three.core.min.js
- examples/jsm/controls/OrbitControls.js

OrbitControls contains one deployment-only change: its bare `three` import points to
the adjacent self-hosted build. No runtime code is loaded from a CDN.
The upstream MIT license is reproduced in LICENSE.txt.
