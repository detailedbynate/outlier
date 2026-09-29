import { PanelSkeleton } from "@/app/dashboard/sections";
import { NicheLoading } from "./niche-loading";

export default function Loading() {
  return (
    <div className="dash niche">
      <NicheLoading />
      <PanelSkeleton rows={3} />
    </div>
  );
}
