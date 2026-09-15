import { PanelSkeleton } from "@/app/dashboard/sections";

export default function Loading() {
  return (
    <div className="dash">
      <PanelSkeleton rows={2} />
      <PanelSkeleton rows={5} />
      <PanelSkeleton rows={4} />
    </div>
  );
}