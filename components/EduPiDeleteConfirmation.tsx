"use client";
import {useModalDismiss} from "@/hooks/useModalDismiss";

export function EduPiDeleteConfirmation({label,onResolve}:{label:string;onResolve:(confirmed:boolean)=>void}) {
  const ref=useModalDismiss<HTMLDivElement>(()=>onResolve(false),true);
  return <div className="edupi-context-modal" onMouseDown={event=>{if(event.target===event.currentTarget)onResolve(false);}}><div ref={ref} className="edupi-delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="edupi-delete-title" tabIndex={-1}><h2 id="edupi-delete-title">删除“{label}”？</h2><div><button type="button" data-autofocus onClick={()=>onResolve(false)}>取消</button><button type="button" className="is-delete" onClick={()=>onResolve(true)}>确认删除</button></div></div></div>;
}
