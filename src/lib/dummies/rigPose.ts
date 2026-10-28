// The dummy poses on the game's own skeleton (the 64-bone rig every person shares, sr1char/rig.ts): the creator's
// standing pose, captured from the running game, with a few joints turned by hand on top. Each turn is about one
// of the game's model-space axes in the bone's parent frame. The character faces +Z there, with its left at -X: a
// negative X turn swings a hanging limb forward; a positive Z turn swings the right arm out (the left arm in).
import * as THREE from 'three'
import { CREATOR_OFFSET, skinMatrices, standingPose, type Rig } from '../sr1char/rig'
import type { Joints, PoseId, V3 } from './figure'

type Turn = [axis: 'x' | 'y' | 'z', radians: number]
/** Per bone: turns added on top of the standing pose, or (`set`) a rotation that replaces it. */
interface RigPose { add?: Record<string, Turn[]>; set?: Record<string, Turn[]> }

// The crouch is the walk-through's (player.ts DRIVE at full crouch): the legs bend to fixed angles, the back leans
// in, the head stays level.
const CROUCH: RigPose = {
  set: {
    Pelvis: [], 'L-Thigh': [['x', -1.4]], 'R-Thigh': [['x', -1.4]], 'L-Calf': [['x', 2.2]], 'R-Calf': [['x', 2.2]],
    'L-Foot': [['x', -0.8]], 'R-Foot': [['x', -0.8]],
  },
  add: {
    Spine: [['x', 0.3]], Spine1: [['x', 0.2]], Neck: [['x', -0.25]], Head: [['x', -0.2]],
    'L-UpperArmTwist1': [['x', -0.35]], 'R-UpperArmTwist1': [['x', -0.35]], 'L-ForeTwist': [['x', -0.4]], 'R-ForeTwist': [['x', -0.4]],
  },
}

export const RIG_POSES: Record<PoseId, RigPose> = {
  standing: {},
  relaxed: { add: { 'L-UpperArmTwist1': [['z', 0.15]], 'R-UpperArmTwist1': [['z', -0.15]], 'L-ForeTwist': [['x', 0.1]], 'R-ForeTwist': [['x', 0.1]] } },
  crouch: CROUCH,
  // The right arm straight out in front at shoulder height; the head turned a little to the hand.
  aim: { add: { 'R-UpperArmTwist1': [['x', -1.45], ['z', -0.12]], 'R-ForeTwist': [['x', 0.12]], 'R-Hand': [['z', 0.1]], Head: [['y', 0.12]] } },
  mannequin: { add: { 'L-UpperArmTwist1': [['z', -0.65]], 'R-UpperArmTwist1': [['z', 0.65]], 'L-ForeTwist': [['z', -0.1]], 'R-ForeTwist': [['z', 0.1]] } },
}

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }
const turns = (list: Turn[]) => list.reduce((q, [a, r]) => new THREE.Quaternion().setFromAxisAngle(AXES[a], r).multiply(q), new THREE.Quaternion())

/** Bone rotations for a pose (facing straight ahead). */
export function poseRotations(pose: PoseId): Record<string, THREE.Quaternion> {
  const out = standingPose(true)
  const p = RIG_POSES[pose]
  for (const [bone, list] of Object.entries(p.set ?? {})) out[bone] = turns(list)
  for (const [bone, list] of Object.entries(p.add ?? {})) out[bone] = turns(list).multiply(out[bone] ?? new THREE.Quaternion())
  return out
}

/** The skinning matrices for a pose, with the creator's joint offsets. */
export const poseMatrices = (rig: Rig, pose: PoseId) => skinMatrices(rig, poseRotations(pose), CREATOR_OFFSET)

const JOINT_BONES: Record<keyof Joints, string> = {
  pelvis: 'Pelvis', chest: 'Spine2', neck: 'Neck', head: 'Head',
  lShoulder: 'L-UpperArmTwist1', lElbow: 'L-ForeTwist', lWrist: 'L-Hand', rShoulder: 'R-UpperArmTwist1', rElbow: 'R-ForeTwist', rWrist: 'R-Hand',
  lHip: 'L-Thigh', lKnee: 'L-Calf', lAnkle: 'L-Foot', lToe: 'L-Toe0', rHip: 'R-Thigh', rKnee: 'R-Calf', rAnkle: 'R-Foot', rToe: 'R-Toe0',
}

/**
 * Where the joints are in a pose, in the dummy's space (metres, facing -Z: the game's model space with Z mirrored),
 * `lift` metres up (the bake's feet-on-the-ground offset). Null when the rig lacks one of them.
 */
export function rigJoints(rig: Rig, skin: THREE.Matrix4[], lift: number): Joints | null {
  const out = {} as Joints
  for (const [joint, bone] of Object.entries(JOINT_BONES) as [keyof Joints, string][]) {
    const i = rig.byName[bone]
    if (i === undefined) return null
    const p = rig.bones[i].rest.clone().applyMatrix4(skin[i])
    out[joint] = [p.x, p.y + lift, -p.z] as V3
  }
  return out
}
