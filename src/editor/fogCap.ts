// The game's fog never covers more than a set strength (half at noon): distant things fade toward the fog colour
// but stay visible. three.js's linear fog always reaches 100%, so its shader chunk is patched once: the strength
// rides in the fog's `far` value (far + STRENGTH_STEP × percent), which every material already receives, so no
// material needs a uniform of its own. A plain THREE.Fog (no percent) keeps working as before.
import * as THREE from 'three'

const STRENGTH_STEP = 10000

let installed = false
export function installFogCap() {
  if (installed) return
  installed = true
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogPct = floor( fogFar / ${STRENGTH_STEP.toFixed(1)} );
		float fogEnd = fogFar - fogPct * ${STRENGTH_STEP.toFixed(1)};
		float fogFactor = clamp( ( vFogDepth - fogNear ) / max( fogEnd - fogNear, 0.001 ), 0.0, 1.0 ) * ( fogPct > 0.0 ? fogPct / 100.0 : 1.0 );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`
}

/** A fog from `near` to `far` (editor units, far under 10000) that never covers more than `strength` (0-1). */
export function cappedFog(color: THREE.ColorRepresentation, near: number, far: number, strength: number): THREE.Fog {
  installFogCap()
  const pct = Math.max(1, Math.min(100, Math.round(strength * 100)))
  return new THREE.Fog(color, near, Math.min(far, STRENGTH_STEP - 1) + STRENGTH_STEP * pct)
}
