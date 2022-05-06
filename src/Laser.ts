import { sgWorld } from "./Axiom";
import { DesktopInputManager } from "./DesktopInputManager";
import { ProgramManager } from "./ProgramManager";
import { Ray } from "./Ray";
import { Sphere } from "./Sphere";

export class Laser {
  ray: Ray = new Ray();
  tip: Sphere = new Sphere();

  constructor() {
    ProgramManager.getInstance().deleteGroup("Laser");
  }

  collision?: {
    originPoint: IPosition,
    hitPoint: IPosition,
    rayLength: number,
    objectID?: string,
    isNothing: boolean
  };

  UpdateTable(position: IPosition) {
    sgWorld.SetParam(8300, position); // Pick ray
    const hitObjectID = sgWorld.GetParam(8310) as string | undefined;
    let distToHitPoint = sgWorld.GetParam(8312) as number;    // Get distance to hit point
    let isNothing = false;
    if (distToHitPoint == 0) {
      distToHitPoint = sgWorld.Navigate.GetPosition(3).Altitude / 2;
      isNothing = true;
    }

    if (isNothing !== this.collision?.isNothing) {
      console.log(isNothing ? "Nothing" : "Something");
    }
    const hitPosition = position.Copy().Move(distToHitPoint, position.Yaw, position.Pitch);
    hitPosition.Cartesian = true;
    this.collision = {
      originPoint: position,
      hitPoint: hitPosition,
      rayLength: distToHitPoint,
      objectID: hitObjectID,
      isNothing: isNothing
    };
  }

  UpdateDesktop() {
    if (this.collision?.isNothing && DesktopInputManager.getCursor().ObjectID !== '') {
      console.log(`hitting ${DesktopInputManager.getCursor().ObjectID}`);
    } else if (!this.collision?.isNothing && DesktopInputManager.getCursor().ObjectID === '') {
      console.log('Not hitting');
    }

    this.collision = {
      originPoint: sgWorld.Navigate.GetPosition(3),
      hitPoint: DesktopInputManager.getCursorPosition(),
      rayLength: sgWorld.Navigate.GetPosition(3).DistanceTo(DesktopInputManager.getCursorPosition()),
      objectID: DesktopInputManager.getCursor().ObjectID,
      isNothing: DesktopInputManager.getCursor().ObjectID === ''
    };
  }

  Draw() {
    this.ray.Draw(this.collision);
    this.tip.Draw(this.collision);
  }
}
