import { ProgramManager } from "./ProgramManager";

declare const SGWorld: ISGWorld;
export const sgWorld = SGWorld;
export const basePath = "\\\\192.168.1.19/d/C-ARMSAS/axiom/";
// export const basePath = "C:/dev/Github/AxiomSkylineHolotable/dist/Axiom/";


if (document.readyState === 'complete')
  ProgramManager.getInstance().Init();
else
  window.addEventListener("load", ProgramManager.getInstance().Init);
