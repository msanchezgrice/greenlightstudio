"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "./board-content";

type Props = {
  projectCount: number;
  pendingCount: number;
  packetCount: number;
  nightShiftCount: number;
  avgConfidence: number | null;
};

function useFlashOnChange(value: number | null) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prev.current !== value && prev.current !== undefined) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);

  return flash;
}

export function BoardStats({ projectCount, pendingCount, packetCount, nightShiftCount, avgConfidence }: Props) {
  const flashProject = useFlashOnChange(projectCount);
  const flashPending = useFlashOnChange(pendingCount);
  const flashPacket = useFlashOnChange(packetCount);
  const flashNight = useFlashOnChange(nightShiftCount);
  const flashConf = useFlashOnChange(avgConfidence);

  return (
    <div className="studio-stats">
      <div className={`studio-stat ${flashProject ? "stat-flash-up" : ""}`}>
        <div className="studio-stat-value" style={{ color: "var(--green)" }}>
          <AnimatedNumber value={projectCount} />
        </div>
        <div className="studio-stat-label">Active Projects</div>
      </div>
      <div className={`studio-stat ${flashPending ? "stat-flash-up" : ""}`}>
        <div className="studio-stat-value warn">
          <AnimatedNumber value={pendingCount} />
        </div>
        <div className="studio-stat-label">Pending Approvals</div>
      </div>
      <div className={`studio-stat ${flashPacket ? "stat-flash-up" : ""}`}>
        <div className="studio-stat-value" style={{ color: "var(--purple)" }}>
          <AnimatedNumber value={packetCount} />
        </div>
        <div className="studio-stat-label">Packets Generated</div>
      </div>
      <div className={`studio-stat ${flashNight ? "stat-flash-up" : ""}`}>
        <div className="studio-stat-value" style={{ color: "#3B82F6" }}>
          <AnimatedNumber value={nightShiftCount} />
        </div>
        <div className="studio-stat-label">Night Shift Enabled</div>
      </div>
      <div className={`studio-stat ${flashConf ? "stat-flash-up" : ""}`}>
        <div className="studio-stat-value good">
          {avgConfidence != null ? <AnimatedNumber value={avgConfidence} /> : "--"}
        </div>
        <div className="studio-stat-label">Avg Confidence</div>
      </div>
    </div>
  );
}
