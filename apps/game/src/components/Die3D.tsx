import type {Ref} from "react"

import type {Die} from "../../../../packages/engine/src/types"

import {DIE_SIZE, FACE_TARGET_ROTATION, FACE_TRANSFORMS} from "./die3dConstants"
import {DieFace} from "./DieFace"

type Props = {
  value: Die,
  used: boolean,
  ref?: Ref<HTMLDivElement>,
}

/**
 * Presentational 3D die. Position + rotation are driven by the parent's
 * physics loop via direct DOM transform writes on the ref prop —
 * this component never re-renders for animation frames.
 */
export function Die3D({
  value,
  used,
  ref,
}: Props) {
  const target = FACE_TARGET_ROTATION[value]
  return (<div
    style={{
      width: DIE_SIZE,
      height: DIE_SIZE,
      perspective: 360,
      overflow: "visible",
    }}>
    <div
      ref={ref}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        transformStyle: "preserve-3d",
        opacity: used ? 0.45 : 1,
        willChange: "transform",
        transition: "opacity 200ms ease", // Initial transform; the parent's physics loop overrides this on roll.
        transform: `translate3d(0px, 0px, 0px) rotateX(${target.x}deg) rotateY(${target.y}deg) rotateZ(0deg)`,
      }}>
      {(Object.keys(FACE_TRANSFORMS) as `${Die}`[]).map((k) => {
        const face = Number(k) as Die
        return (<DieFace
          key={face}
          face={face}
          transform={FACE_TRANSFORMS[face]}
          used={used}/>)
      })}
    </div>
  </div>)
}
