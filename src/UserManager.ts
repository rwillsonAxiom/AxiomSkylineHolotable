import { basePath, sgWorld, sessionManager } from "./Axiom";
import { ControllerReader } from "./ControllerReader";
import { Laser } from "./Laser";
import { Quaternion } from "./math/quaternion";
import { Vector } from "./math/vector";
import { degsToRads, radsToDegs } from "./Mathematics";
import { deleteItemSafe, DeviceType, GetDeviceType, GetObject, MaxZoom, ProgramManager, ProgramMode, roomToWorldCoord, worldToRoomCoord } from "./ProgramManager";
import { UndoManager } from "./UndoManager";

const enum ControlMode {
  Wand,
  Table,
  Wall
}

const redRGBA = [255, 15, 15, 255];
const blueRGBA = [15, 15, 255, 255];
const greenRGBA = [15, 255, 15, 255];
const blackRGBA = [0, 0, 0, 200];

const gControlMode: ControlMode = ControlMode.Table;

function dragMode() {
  const trigger = ProgramManager.getInstance().getButton3(1);
  const newIntersect = ProgramManager.getInstance().userModeManager!.getCollisionPosition(1);
  const wandWorldIPos = ProgramManager.getInstance().userModeManager?.getWandPosition(1);

  if (wandWorldIPos === undefined)
    throw new Error("Unable to find wand position");
  const wandRoomIPos = worldToRoomCoord(wandWorldIPos);

  const wandOri1 = Quaternion.FromYPR(-degsToRads(wandRoomIPos.Yaw), degsToRads(wandRoomIPos.Pitch), degsToRads(wandRoomIPos.Roll));
  // orientation is wrong on the wall. Pitch down
  const wandOri = wandOri1;
  const wandRoomDir = wandOri.GetYAxis(1);
  const wandRoomPos = new Vector<3>([wandRoomIPos.X, wandRoomIPos.Y, wandRoomIPos.Altitude]);

  if (newIntersect === undefined) {
    return;
  }
  const worldIntersect = worldToRoomCoord(newIntersect);
  const worldX = worldIntersect.X;
  const worldY = GetDeviceType() == DeviceType.Table ? worldIntersect.Y : worldIntersect.Altitude;
  if (ControllerReader.roomExtent !== undefined) {
    const minX = ControllerReader.roomExtent.min.data[0];
    const maxX = ControllerReader.roomExtent.max.data[0];
    const minY = ControllerReader.roomExtent.min.data[GetDeviceType() == DeviceType.Table ? 1 : 2];
    const maxY = ControllerReader.roomExtent.max.data[GetDeviceType() == DeviceType.Table ? 1 : 2];
    const deadzone = 1;
    if (worldX < minX - deadzone || worldX > maxX + deadzone || worldY < minY - deadzone || worldY > maxY + deadzone)
      return;
  }
  if (dragMode.startInfo !== null) {
    if (!trigger) {
      dragMode.startInfo = null;
      return;
    }
    // dragged!
    const worldPos = sgWorld.Navigate.GetPosition(3).Copy();

    worldPos.X += dragMode.startInfo.intersect.X - newIntersect.X;
    worldPos.Y += dragMode.startInfo.intersect.Y - newIntersect.Y;

    // zoom
    const wandPosDiff = wandRoomPos.Copy().Sub(dragMode.startInfo.prevWandRoomPos);
    const magDifference = wandPosDiff.Mag();
    if (magDifference > 0 && magDifference < 1) {
      let forwardOrBack = wandPosDiff.Dot(dragMode.startInfo.prevWandRoomDir);
      forwardOrBack = forwardOrBack >= 0 ? 1 : -1;
      let scaleRatio = 5;

      const degs = radsToDegs(Math.acos(Math.abs(wandPosDiff.Copy().Normalise().Dot(dragMode.startInfo.prevWandRoomDir.Copy().Normalise()))));
      const thresholdLower = 25;
      const thresholdUpper = 40;
      const thresholdRange = thresholdUpper - thresholdLower;
      const scalingRatio = 1 - Math.min(Math.max(degs, thresholdLower) - thresholdLower, thresholdRange) / thresholdRange;

      let power = forwardOrBack * scalingRatio * magDifference * 2;
      let powerStrength = 1;
      if (GetDeviceType() == DeviceType.Wall) {
        let curAltitudeRatio = worldPos.Altitude / 2000; // scaling now works less as you go from 1000 down to 10 altitude
        console.log("worldPos.Altitude " + worldPos.Altitude)
        powerStrength = Math.min(Math.max(curAltitudeRatio, 0.25), 1);
      }
      const factor = Math.pow(scaleRatio, power * powerStrength);
      worldPos.Altitude *= factor;
      // TODO: also offset position due to zoom. Otherwise one frame of jitter whenever zooming

      const maxTableAltitude = 500000;
      const maxWallAltitude = 60000;
      if (GetDeviceType() === DeviceType.Table && worldPos.Altitude > maxTableAltitude) {
        worldPos.Altitude = maxTableAltitude;
      } else if (GetDeviceType() === DeviceType.Wall && worldPos.Altitude > maxWallAltitude) {
        worldPos.Altitude = maxWallAltitude;
      }
      if (worldPos.Altitude < 250) {
        worldPos.Altitude = 250;
      }
    }

    dragMode.startInfo.prevWandRoomPos = wandRoomPos;
    dragMode.startInfo.prevWandRoomDir = wandRoomDir;

    sgWorld.Navigate.SetPosition(worldPos);
  } else if (trigger) {
    dragMode.startInfo = {
      intersect: newIntersect,
      prevWandRoomPos: wandRoomPos,
      prevWandRoomDir: wandRoomDir
    }
  }
}
dragMode.startInfo = <{
  intersect: IPosition;
  prevWandRoomPos: Vector<3>;
  prevWandRoomDir: Vector<3>;
} | null>null;

export const enum UserMode {
  Standard, // this can include FlyTo, but also just standard navigation; we don't distinguish them for now
  Measurement,
  DropRangeRing,
  PlaceModel,
  MoveModel,
  DrawLine,
  PlaceLabel // when placing a label it will attach to another object
}

// If trigger is pressed: move in the direction of the ray
function wandMode(laser: Laser) {
  if (ProgramManager.getInstance().getButton3(1) && laser.collision) {
    const posCurrent = sgWorld.Navigate.GetPosition(3);
    const posDest = laser.collision.hitPoint.Copy();
    posDest.Altitude = laser.collision.originPoint.Altitude;
    const dir = laser.collision.originPoint.AimTo(posDest);
    let newPos = posCurrent.Move(posDest.Altitude * 0.05, dir.Yaw, 0);
    newPos.Yaw = posCurrent.Yaw;
    newPos.Pitch = posCurrent.Pitch;
    sgWorld.Navigate.SetPosition(newPos);
  }
  // go up
  if (ProgramManager.getInstance().getButton1(1)) {
    let newPos = sgWorld.Navigate.GetPosition(3);
    newPos.Altitude *= 1.1;
    sgWorld.Navigate.SetPosition(newPos);
  }
  // go down
  if (ProgramManager.getInstance().getButton2(1)) {
    let newPos = sgWorld.Navigate.GetPosition(3);
    newPos.Altitude *= 0.9;
    sgWorld.Navigate.SetPosition(newPos);
  }
}

// sets the selection whenever the user presses a button on the on a valid model or collision object
function setSelection(laser: Laser, button1pressed: boolean) {
  // if laser has collided with something and the button is pressed set the selection to the objectID
  if ((laser.collision != undefined) && button1pressed) {
    const objectIDOfSelectedModel = laser.collision.objectID;
    if (objectIDOfSelectedModel === undefined) {
      console.log("not selecting model");
    } else {
      console.log(`selecting model: ${objectIDOfSelectedModel}`);
    }
    // if the laser is not colliding with something and the button is pressed update the selection to undefined
    ProgramManager.getInstance().userModeManager?.toggleMoveModelMode(objectIDOfSelectedModel);
  }
}

let lastHighlight: string | undefined;
function highlightIntersected(laser: Laser) {
  highlightById(false, lastHighlight);
  if (laser.collision != undefined) {
    const oid = laser.collision.objectID;
    highlightById(true, oid);
    lastHighlight = oid;
  }
}

let tooltipTimeout: number;
let lastTooltip: string = "";
let lastTooltipModelID: string = "";
let highlightedId = "";
let previousCol: number[] = [];
function showTooltipIntersected(laser: Laser) {
  if (laser.collision != undefined && laser.collision.objectID) {
    const model = GetObject(laser.collision.objectID) as ITerrainModel;
    if (model && lastTooltipModelID !== model.ID && model.Tooltip.Text) {
      tooltipTimeout = setTimeout(() => {
        if (lastTooltip) deleteItemSafe(lastTooltip)
        const labelStyle = sgWorld.Creator.CreateLabelStyle(0);
        labelStyle.LockMode = LabelLockMode.LM_AXIS_AUTOPITCH_TEXTUP
        // DW tried to check for overlaps but 
        const modelPosition = model.Position;
        const modelInRoom = worldToRoomCoord(modelPosition);
        const adj = 0.05;
        let modelInRoomAdj = sgWorld.Creator.CreatePosition(modelInRoom.X, modelInRoom.Y + adj, modelInRoom.Altitude, modelInRoom.AltitudeType);
        let modelInWorldAdj = roomToWorldCoord(modelInRoomAdj);
        // this never works on the table, it returns 0, 0
        // const pixel = sgWorld.Window.PixelFromWorld(model.Position, 0);
        // console.log("pixel " + pixel.X + " " + pixel.Y);
        // let col = sgWorld.Window.PixelToWorld(pixel.X, pixel.Y - 70, 1);
        // console.log(col.ObjectID);
        const groupId = ProgramManager.getInstance().getGroupID("buttons")
        const tooltip = sgWorld.Creator.CreateTextLabel(roomToWorldCoord(modelInRoomAdj), model.Tooltip.Text, labelStyle, groupId, "tooltip");
        lastTooltip = tooltip.ID;
      }, 300)
    }
    if (model) {
      lastTooltipModelID = model.ID
    }
  }
  else {
    if (lastTooltip) {
      deleteItemSafe(lastTooltip)
      lastTooltip = "";
      lastTooltipModelID = "";
    }
    clearTimeout(tooltipTimeout);
  }
}

function highlightById(highlight: boolean, oid?: string): void {
  const model = GetObject(oid)
  if (model && oid) {

    if (highlight) {
      if (highlightedId != oid) {
        let deltaA = -50; // make it slightly lighter
        previousCol = colorToRGBA(model.Terrain.Tint);
        if (previousCol[3] === 0) { // no tint we will add one to lighten it up
          deltaA = 50
        }
        if (previousCol[3] + deltaA > 0) {
          model.Terrain.Tint = sgWorld.Creator.CreateColor(previousCol[0], previousCol[1], previousCol[2], previousCol[3] + deltaA);
          highlightedId = oid;
        }
      }
    } else {
      // remove tint
      model.Terrain.Tint = sgWorld.Creator.CreateColor(previousCol[0], previousCol[1], previousCol[2], previousCol[3]);
      highlightedId = "";
    }
  }
}

function colorToRGBA(col: IColor): number[] {
  const rgba = col.ToARGBColor();
  const a = (rgba >> 24) & 0xFF;
  const red = (rgba >> 16) & 0xFF;
  const green = (rgba >> 8) & 0xFF;
  const blue = rgba & 0xFF;
  return [red, green, blue, a]
}

const wallMode = wandMode;

export class UserModeManager {
  public userMode = UserMode.Standard;
  public modelIds: string[] = [];

  private spacing = 5000;
  private numRings = 5;
  private measurementModeFirstPoint: IPosition | null = null;
  private measurementModeLineID: string | null = null;
  private measurementTextLabelID: string | null = null;
  private currentlySelectedId?: string;
  private measurementLineWidth = 3;
  private measurementLineColor: IColor;
  private decimalPlaces = 3;
  private measurementLabelStyle: ILabelStyle;
  private labelStyle = sgWorld.Creator.CreateLabelStyle(0);

  private drawLineID: string | null = null;
  private drawLineFirstPoint: IPosition | null = null;
  private drawLineWidth = -10;
  private drawLineColor: IColor;
  private drawButtonId: string | undefined;

  private laser1?: Laser;
  private laser2?: Laser;

  // these colours need to be accessible from other classes
  public redRGBA: Array<number> = redRGBA;
  public blueRGBA: Array<number> = blueRGBA;

  private ModelZScaleFactor: number = 0.25;

  constructor() {
    this.measurementLineColor = sgWorld.Creator.CreateColor(255, 255, 0, 255);
    this.measurementLabelStyle = sgWorld.Creator.CreateLabelStyle(0);
    this.measurementLabelStyle.PivotAlignment = "Top";
    this.measurementLabelStyle.MultilineJustification = "Left";
    this.drawLineColor = sgWorld.Creator.CreateColor(0, 0, 0, 0); //black
  }

  getCollisionID(userIndex: number) {
    switch (userIndex) {
      case 0: return this.laser2?.collision?.objectID;
      case 1: return this.laser1?.collision?.objectID;
    }
  }

  getCollisionPosition(userIndex: number) {
    switch (userIndex) {
      case 0: return this.laser2?.collision?.hitPoint;
      case 1: return this.laser1?.collision?.hitPoint;
    }
  }

  getWandPosition(userIndex: number) {
    switch (userIndex) {
      case 0: return this.laser2?.collision?.originPoint;
      case 1: return this.laser1?.collision?.originPoint;
    }
  }

  Init() {
    ProgramManager.getInstance().deleteGroup("Laser");
    this.laser1 = new Laser(ProgramManager.getInstance().getGroupID("Laser"));
    this.laser2 = new Laser(ProgramManager.getInstance().getGroupID("Laser"));
  }

  Draw() {
    this.laser1?.Draw();
    if (GetDeviceType() === DeviceType.Table)
      this.laser2?.Draw(); // On the Wall, the second laser shouldn't be rendered
  }

  toggleMeasurementMode(buttonId?: string) {
    if (this.userMode == UserMode.Measurement) {
      highlightById(true, buttonId);
      if (this.measurementModeLineID !== null) {
        deleteItemSafe(this.measurementModeLineID);
        deleteItemSafe(this.measurementTextLabelID!);
      }
      this.userMode = UserMode.Standard;
    } else {
      this.userMode = UserMode.Measurement;
    }
    this.measurementModeLineID = null;
    this.measurementTextLabelID = null;
    this.measurementModeFirstPoint = null;
  }

  toggleModelMode(modelPath: string, modelName: string, modelColor: string) {
    if (this.userMode == UserMode.PlaceModel) {
      console.log("end model mode");
      this.userMode = UserMode.Standard;
    } else {
      const fullModelPath = basePath + `model/${modelPath}`;
      const pos = sgWorld.Window.CenterPixelToWorld(0).Position.Copy()
      pos.Pitch = 0;
      console.log("creating model:: " + modelPath);
      const grp = ProgramManager.getInstance().getCollaborationFolderID("models_" + modelColor);
      const model = sgWorld.Creator.CreateModel(pos, fullModelPath, 1, 0, grp, modelName);
      let color = this.getColorFromString(modelColor);

      model.Terrain.Tint = color;
      // this is required to refresh the collaboration mode
      console.log("setting visibility to true");
      sgWorld.ProjectTree.SetVisibility(model.ID, true);
      const roomPos = roomToWorldCoord(sgWorld.Creator.CreatePosition(0, 0, 0.7, AltitudeTypeCode.ATC_TERRAIN_ABSOLUTE));
      model.ScaleFactor = 5 * roomPos.Altitude;

      if (GetDeviceType() === DeviceType.Wall) {
        const pos = sgWorld.Navigate.GetPosition(3);
        model.ScaleFactor = pos.Altitude / 2;
      }


      // adam wanted the original models less tall so multiply scale z by a factor
      model.ScaleZ *= this.ModelZScaleFactor;

      // this will make the model not pickable which is what you want while moving it 
      model.SetParam(200, 0x200);

      this.currentlySelectedId = model.ID;
      this.modelIds.push(this.currentlySelectedId);
      ProgramManager.getInstance().currentlySelected = this.currentlySelectedId;

      // add the new model to the line objects array so it can be deleted via the undo button
      UndoManager.getInstance().AddItem(this.currentlySelectedId);

      this.userMode = UserMode.PlaceModel;
    }
  }

  getColorFromString(modelColor: string, opacity: number = -1) {
    switch (modelColor) {
      case "blue":
        return sgWorld.Creator.CreateColor(blueRGBA[0], blueRGBA[1], blueRGBA[2], opacity > 0 ? opacity : blueRGBA[3]);
      case "red":
        return sgWorld.Creator.CreateColor(redRGBA[0], redRGBA[1], redRGBA[2], opacity > 0 ? opacity : redRGBA[3]);
      case "green":
        return sgWorld.Creator.CreateColor(greenRGBA[0], greenRGBA[1], greenRGBA[2], opacity > 0 ? opacity : greenRGBA[3]);
      case "black":
        return sgWorld.Creator.CreateColor(blackRGBA[0], blackRGBA[1], blackRGBA[2], opacity > 0 ? opacity : blackRGBA[3]);
    }
    return sgWorld.Creator.CreateColor(blueRGBA[0], blueRGBA[1], blueRGBA[2], blueRGBA[3]);
  }

  toggleLabel(sLabel: string) {
    if (this.userMode == UserMode.PlaceModel) {
      console.log("end model mode");
      this.userMode = UserMode.Standard;
    } else {
      const grp = ProgramManager.getInstance().getCollaborationFolderID("models");
      const pos = sgWorld.Window.CenterPixelToWorld(0).Position.Copy()
      const labelStyle = sgWorld.Creator.CreateLabelStyle(0);
      const label = sgWorld.Creator.CreateTextLabel(pos, sLabel, labelStyle, grp, "label-" + sLabel);
      pos.Pitch = 0;
      console.log("creating label:: " + sLabel + " " + label.ObjectType);
      // check if the user was placing a label and changed their mind
      if (this.userMode == UserMode.PlaceLabel) {
        const label = GetObject(this.currentlySelectedId, ObjectTypeCode.OT_LABEL) as ITerrainLabel;
        if (label) {
          deleteItemSafe(label.ID)
        }
      }

      this.currentlySelectedId = label.ID;
      // add the new label to the line objects array so it can be deleted via the undo button
      UndoManager.getInstance().AddItem(label.ID)
      this.userMode = UserMode.PlaceLabel;
    }
  }

  toggleMoveModelMode(modelID?: string) {
    const previouslySelected = this.currentlySelectedId;
    this.currentlySelectedId = modelID;
    if (this.userMode == UserMode.MoveModel) {
      this.userMode = UserMode.Standard;
    } else {
      // We have just selected the model
      if (modelID !== undefined) {
        console.log(`modelID = ${modelID}, typeof = ${typeof modelID}`);
        const modelObject = GetObject(modelID) as ITerrainModel;
        if (modelObject) {
          // this will make the model not pickable which is what you want while moving it 
          modelObject.SetParam(200, 0x200);
          console.log("made it uncollidebale");
        }
        this.userMode = UserMode.MoveModel;
      } else {
        this.userMode = UserMode.Standard;
      }
    }
  }

  setStandardMode() {
    this.userMode = UserMode.Standard;
  }

  toggleRangeRingMode() {
    if (this.userMode == UserMode.DropRangeRing)
      this.userMode = UserMode.Standard;
    else
      this.userMode = UserMode.DropRangeRing;
  }

  dropRangeRing() {
    console.log("dropRangeRing");
    let lineColor; //red for customer requirements
    const fillColor = sgWorld.Creator.CreateColor(0, 0, 0, 0); //"0x00000000";
    const pos = this.laser1!.collision!.hitPoint.Copy();
    const objNamePrefix = pos.X + "long" + pos.Y + "lat" + pos.Altitude + "mAlt_";

    //create centre circle
    const centerFillColour = sgWorld.Creator.CreateColor(0, 0, 0, 255);
    sgWorld.Creator.CreateCircle(pos, 500, fillColor, centerFillColour, "", "Centre Range Ring");

    for (let i = 1; i <= this.numRings; i++) {
      const radius = this.spacing * i
      const itemName = objNamePrefix + "RangeRing" + radius + "m";
      if (radius >= 25000) {
        lineColor = sgWorld.Creator.CreateColor(255, 0, 0, 255);
      } else {
        lineColor = sgWorld.Creator.CreateColor(0, 0, 0, 255);
      }
      const circle = sgWorld.Creator.CreateCircle(pos, radius, lineColor, fillColor, "", itemName);
      circle.NumberOfSegments = 50;

      const newPos = pos.Move(radius, 270, 0);
      sgWorld.Creator.CreateTextLabel(
        newPos,
        radius + "m",
        this.labelStyle,
        "",
        itemName);
    }
  }

  scaleModel(scaleVector: number): void {
    if (this.currentlySelectedId === undefined) {
      console.log("Nothing selected to scale");
      return;
    }
    const model = GetObject(this.currentlySelectedId) as ITerrainModel;
    if (model) {
      model.ScaleFactor *= Math.pow(1.2, scaleVector); // 20% larger/smaller increments
      // adam wanted all the models to be shorter
      model.ScaleZ *= this.ModelZScaleFactor;
    }
  }

  deleteModel(): void {

    if (this.currentlySelectedId === undefined) {
      console.log("Nothing selected to delete");
      return;
    }
    if (this.userMode === UserMode.PlaceLabel) {
      // const label = GetObject(this.currentlySelectedId, ObjectTypeCode.OT_LABEL) as ITerrainLabel;
      deleteItemSafe(this.currentlySelectedId)
    } else {
      const model = GetObject(this.currentlySelectedId);
      if (model) {
        deleteItemSafe(this.currentlySelectedId)
      }
    }
    // delete the model from the undo array so it doesn't cause issues with the undo button
    UndoManager.getInstance().Remove(this.currentlySelectedId);
  }

  // deletes the most recent item that was added to the lineObjects array
  // if there is nothing in the array doesn't do anything
  undo(): void {
    console.log("undo")
    const deleted = UndoManager.getInstance().Undo();
    if (deleted.indexOf(ProgramManager.getInstance().currentlySelected) > -1) {
      ProgramManager.getInstance().currentlySelected = "none";
    }
  }


  toggleDrawLine(buttonId?: string): void {
    this.userMode = UserMode.DrawLine;
    this.drawLineID = null;
    this.drawLineFirstPoint = null;
    this.drawButtonId = buttonId;
    highlightById(true, this.drawButtonId);
  }

  toggleDrawRectangle(): void {

    const grp = ProgramManager.getInstance().getCollaborationFolderID("drawings");
    const rect = sgWorld.Drawing.DrawRectangle(DrawingMode.DRAW_MODE_MAGNET, grp);

    const onDraw = (geometry: any) => {

      try {
        if (!rect || rect.ID) return;
        UndoManager.getInstance().AddItem(rect.ID);
        rect.LineStyle.Color = this.getColorFromString("green")
        console.log("drawn");
        sgWorld.DetachEvent("OnDrawingFinished", onDraw);
      } catch (error) {
        // don't worry
      }

    }
    sgWorld.AttachEvent("OnDrawingFinished", onDraw);

  }

  Update() {
    try {

      const button1pressed = ProgramManager.getInstance().getButton1Pressed(1);
      switch (ProgramManager.getInstance().getMode()) {
        case ProgramMode.Desktop: this.laser1?.UpdateDesktop(); break;
        case ProgramMode.Device:
          this.laser1?.UpdateTable(1);
          this.laser2?.UpdateTable(0);
          break;
      }
      switch (gControlMode) {
        case ControlMode.Table:
          dragMode();
          break;
        case ControlMode.Wall:
          wallMode(this.laser1!);
          break;
        case ControlMode.Wand:
          wandMode(this.laser1!);
          break;
      }
      switch (this.userMode) {
        case UserMode.Standard:
          setSelection(this.laser1!, button1pressed);
          showTooltipIntersected(this.laser1!)
          highlightIntersected(this.laser1!);
          break;
        case UserMode.Measurement:
          if (this.measurementModeFirstPoint !== null && this.measurementTextLabelID !== null && this.measurementModeLineID !== null) {
            // Move the line end position to the cursor
            const teEndPos = this.laser1!.collision!.hitPoint.Copy();
            const teStartPos = this.measurementModeFirstPoint.Copy().AimTo(teEndPos);
            const mLine = GetObject(this.measurementModeLineID, ObjectTypeCode.OT_POLYLINE) as ITerrainPolyline;
            if (!mLine) return;
            const Geometry = mLine.Geometry as ILineString;
            Geometry.StartEdit();
            Geometry.Points.Item(1).X = teEndPos.X;
            Geometry.Points.Item(1).Y = teEndPos.Y;
            Geometry.EndEdit();

            // Update the label
            const direction: string = teStartPos.Yaw.toFixed(this.decimalPlaces);
            const distance: string = teStartPos.DistanceTo(teEndPos).toFixed(this.decimalPlaces);
            const strLabelText = `${direction} ${String.fromCharCode(176)} / ${distance}m`;
            const teHalfPos = teStartPos.Move(teStartPos.DistanceTo(teEndPos) / 2, teStartPos.Yaw, 0);
            const mLabel = GetObject(this.measurementTextLabelID, ObjectTypeCode.OT_LABEL) as ITerrainLabel;
            if (!mLabel) return;
            mLabel.Text = strLabelText;
            mLabel.Position = teHalfPos;

            // Exit mode when pressed again
            if (ProgramManager.getInstance().getButton1Pressed(1)) {
              console.log("finished line");
              highlightById(false, this.drawButtonId);

              ProgramManager.getInstance().refreshCollaborationModeLayers(mLine.ID);
              this.setStandardMode();
              // consume the button press
              ControllerReader.controllerInfos[1].button1Pressed = false;
              this.measurementModeLineID = null;
              this.measurementTextLabelID = null;
              this.measurementModeFirstPoint = null;
            }
          } else if (ProgramManager.getInstance().getButton1Pressed(1)) {
            // Create the line and label
            console.log("new line");

            this.measurementModeFirstPoint = this.laser1!.collision!.hitPoint.Copy();

            const teStartPos = this.measurementModeFirstPoint.Copy();
            const teEndPos = teStartPos.Copy();

            const strLineWKT = "LineString( " + teStartPos.X + " " + teStartPos.Y + ", " + teEndPos.X + " " + teEndPos.Y + " )";
            const lineGeom = sgWorld.Creator.GeometryCreator.CreateLineStringGeometry(strLineWKT);
            const grp = ProgramManager.getInstance().getCollaborationFolderID("drawings");
            const mLine = sgWorld.Creator.CreatePolyline(lineGeom, this.measurementLineColor, 2, grp, "__line");
            mLine.LineStyle.Width = this.measurementLineWidth;
            this.measurementModeLineID = mLine.ID;
            this.measurementTextLabelID = sgWorld.Creator.CreateTextLabel(teStartPos, "0m", this.measurementLabelStyle, grp, "___label").ID;

            // add the label and the line to the line objects array so it can be deleted in sequence vai the undo button
            // if you add any other object types into the lineObjects array make sure you handle them in the undo function
            UndoManager.getInstance().AddItems([this.measurementModeLineID, this.measurementTextLabelID])
            // consume the button press
            ControllerReader.controllerInfos[1].button1Pressed = false;
          }
          break;
        case UserMode.DropRangeRing:
          if (ProgramManager.getInstance().getButton1Pressed(1)) {
            this.dropRangeRing();
            this.setStandardMode();
            // consume the button press
            ControllerReader.controllerInfos[1].button1Pressed = false;
          }
          break;
        case UserMode.PlaceModel: // Fall-through because currently these two modes do the exact same thing
        case UserMode.MoveModel:
          const modelObject = GetObject(this.currentlySelectedId!);
          if (!modelObject) {
            // user most likely deleted it using delete button
            this.userMode = UserMode.Standard;
            break;
          } else {
            if (ProgramManager.getInstance().getButton1Pressed(1)) {
              // this is for making the model collide-able again
              modelObject.SetParam(200, modelObject.GetParam(200) & (~512));
              ProgramManager.getInstance().refreshCollaborationModeLayers(modelObject.ID);
              this.setStandardMode();
              // consume the button press
              ProgramManager.getInstance().setButton1Pressed(1, false);
            } else {
              const newModelPosition = ProgramManager.getInstance().getCursorPosition(1)?.Copy();
              if (newModelPosition !== undefined) {
                newModelPosition.Pitch = 0;

                // adam asked for models to always be north facing so yaw is 0 on every update now
                var modelName = sgWorld.ProjectTree.GetItemName(this.currentlySelectedId!);
                modelName = modelName.toLocaleLowerCase();
                // if its an orbat, it is not rotatable. Also if on wall stop rotation
                if (modelName.indexOf('orbat') !== -1 || GetDeviceType() === DeviceType.Wall) {
                  newModelPosition.Yaw = 0;
                } else {
                  newModelPosition.Yaw = newModelPosition.Roll * 2;
                }

                newModelPosition.Roll = 0;
                const modelObject = GetObject(this.currentlySelectedId!);
                if (!modelObject) {
                  // user most likely deleted it
                } else {
                  modelObject.Position = newModelPosition;
                }
              }

              if (GetDeviceType() === DeviceType.Wall) {


              }

              // disable/enable tinting of models, disabled for now as it is not currently required
              const enableColourToggle = false;
              if (ProgramManager.getInstance().getButton2Pressed(1) && enableColourToggle) {
                const modelObject = GetObject(this.currentlySelectedId!) as ITerrainModel;
                if (modelObject) {
                  console.log(modelObject.Terrain.Tint.ToHTMLColor());
                  console.log("ARGBColour: " + modelObject.Terrain.Tint.ToARGBColor());

                  var blueColor = sgWorld.Creator.CreateColor(blueRGBA[0], blueRGBA[1], blueRGBA[2], blueRGBA[3]);
                  var redColor = sgWorld.Creator.CreateColor(redRGBA[0], redRGBA[1], redRGBA[2], redRGBA[3]);
                  if (modelObject.Terrain.Tint.ToARGBColor() === redColor.ToARGBColor()) {
                    modelObject.Terrain.Tint = blueColor;
                  } else {
                    modelObject.Terrain.Tint = redColor;
                  }
                }
              }
            }
          }
          break;
        case UserMode.PlaceLabel:
          try {
            // we will only let the label be placed on another object
            if (ProgramManager.getInstance().getButton1Pressed(1)) {
              const intersectedItemId = ProgramManager.getInstance().userModeManager?.getCollisionID(1);
              if (intersectedItemId) {
                const model = GetObject(intersectedItemId) as ITerrainModel;
                const label = GetObject(this.currentlySelectedId, ObjectTypeCode.OT_LABEL) as ITerrainLabel;
                if (model && label) {
                  label.Style.FontSize = 20;
                  label.Style.TextAlignment = "Left";
                  label.Style.Bold = true;
                  label.Style.BackgroundColor = sgWorld.Creator.CreateColor(255, 255, 255, 0);
                  // setTimeout(() => {
                  //   label.Style.MaxViewingHeight = 10000;
                  // }, 1000)
                  const offsetX = 1 - (model.ScaleFactor / 3.3);
                  label.Attachment.AttachTo(model.ID, offsetX, 0, 0, 0, 0, 0);
                  ProgramManager.getInstance().refreshCollaborationModeLayers(label.ID);
                  this.setStandardMode();
                  // consume the button press
                  ProgramManager.getInstance().setButton1Pressed(1, false);
                }
              };
            } else {
              if (ProgramManager.getInstance().getButton2Pressed(1)) {
                const label = GetObject(this.currentlySelectedId, ObjectTypeCode.OT_LABEL) as ITerrainLabel;
                if (!label) {
                  deleteItemSafe(this.currentlySelectedId!)
                  this.currentlySelectedId = "";
                }
              }
              const newModelPosition = ProgramManager.getInstance().getCursorPosition(1)?.Copy();
              if (newModelPosition !== undefined) {
                newModelPosition.Pitch = 0;
                newModelPosition.Yaw = newModelPosition.Roll * 2;
                newModelPosition.Roll = 0;
                const label = GetObject(this.currentlySelectedId, ObjectTypeCode.OT_LABEL) as ITerrainLabel;
                if (!label) {
                  // it has been killed
                  this.userMode = UserMode.Standard;
                } else {
                  label.Position = newModelPosition;
                }
              }
            }
          } catch (error) {
            console.log("error in place label:: " + error);
          }
          break;
        case UserMode.DrawLine:
          if (this.drawLineFirstPoint !== null && this.drawLineID !== null) {

            // Move the line end position to the cursor
            var dLine = GetObject(this.drawLineID, ObjectTypeCode.OT_POLYLINE) as ITerrainPolyline;
            if (!dLine) {
              // fail
              this.userMode = UserMode.Standard;
              return;
            };
            var Geometry = dLine.Geometry as ILineString;

            const teEndPos = ProgramManager.getInstance().getCursorPosition(1)?.Copy();
            if (teEndPos !== undefined) {
              // start the edit session to enable modification of the geometry
              Geometry.StartEdit();
              if (ProgramManager.getInstance().getButton1Pressed(1)) {
                // if button 1 is pressed add a new point to the geometry
                Geometry.Points.AddPoint(teEndPos.X, teEndPos.Y, teEndPos.Altitude);
              } else {
                // if button hasn't been pressed just move the last point to the current
                // position of the laser so the user what the new line will look like
                const drawPointIndex = Geometry.Points.Count - 1;
                Geometry.Points.Item(drawPointIndex).X = teEndPos.X;
                Geometry.Points.Item(drawPointIndex).Y = teEndPos.Y;
              }
              Geometry.EndEdit();
            }

            // Exit mode when button 2 is pressed
            if (ProgramManager.getInstance().getButton2Pressed(1)) {
              console.log("finished line");
              // delete the last point as this will not have been placed by the user just drawn for planning
              if (Geometry.Points.Count > 0) {
                Geometry.StartEdit();
                Geometry.Points.DeletePoint(Geometry.Points.Count - 1);
                Geometry.EndEdit();
              }

              ProgramManager.getInstance().refreshCollaborationModeLayers(dLine.ID);
              this.setStandardMode();
              // consume the button press
              ControllerReader.controllerInfos[1].button2Pressed = false;
              this.drawLineID = null;
              this.drawLineFirstPoint = null;
            }
          } else if (ProgramManager.getInstance().getButton1Pressed(1)) {
            // Create the line
            console.log("new line");

            this.drawLineFirstPoint = this.laser1!.collision!.hitPoint.Copy();

            const teStartPos = this.drawLineFirstPoint.Copy();
            const teEndPos = teStartPos.Copy();

            const strLineWKT = "LineString( " + teStartPos.X + " " + teStartPos.Y + ", " + teEndPos.X + " " + teEndPos.Y + " )";
            const drawLineGeom = sgWorld.Creator.GeometryCreator.CreateLineStringGeometry(strLineWKT);
            const grp = ProgramManager.getInstance().getCollaborationFolderID("drawings");
            const dLine = sgWorld.Creator.CreatePolyline(drawLineGeom, this.drawLineColor, 2, grp, "__line");
            dLine.LineStyle.Width = this.drawLineWidth;
            this.drawLineID = dLine.ID;

            // add the new item to the array so it can be deleted in sequence via the undo button
            // if you add any other object types into the lineObjects array make sure you handle them in the undo function
            UndoManager.getInstance().AddItem(this.drawLineID)

            // consume the button press
            ControllerReader.controllerInfos[1].button1Pressed = false;
          }
          break;
      }
    } catch (error) {
      // for demo we can't have errors
      console.log("UPDATE ERROR" + error)
    }
  }
}
