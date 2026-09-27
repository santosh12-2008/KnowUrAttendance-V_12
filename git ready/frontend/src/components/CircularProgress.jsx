import React, { useEffect, useState } from 'react';
import { formatAttendancePercentage } from '../utils/attendance';

export default function CircularProgress({ 
  percentage = 0, 
  size = 120, 
  strokeWidth = 10, 
  color = "green", 
  label = "",
  sublabel = "",
  showPercentage = true,
  animate = true
}) {
  const [animatedPct, setAnimatedPct] = useState(0);

  useEffect(() => {
    if (!animate) {
      setAnimatedPct(percentage);
      return;
    }
    const timer = setTimeout(() => {
      setAnimatedPct(percentage);
    }, 100);
    return () => clearTimeout(timer);
  }, [percentage, animate]);

  // Radius and circumference
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (animatedPct / 100) * circumference;

  // Determine color scheme based on requirement:
  // > 90: green, > 75 and <= 90: orange, <= 75: red
  let strokeColor = "#16a34a"; // green-600
  let trackColor = "#dcfce7";  // green-100
  let textColor = "#15803d";   // green-700
  let glowColor = "rgba(22, 163, 74, 0.25)";

  if (color === "orange" || (percentage <= 90.0 && percentage > 75.0)) {
    strokeColor = "#ea580c"; // orange-600
    trackColor = "#ffedd5";  // orange-100
    textColor = "#c2410c";   // orange-700
    glowColor = "rgba(234, 88, 12, 0.25)";
  } else if (color === "red" || percentage <= 75.0) {
    strokeColor = "#dc2626"; // red-600
    trackColor = "#fee2e2";  // red-100
    textColor = "#b91c1c";   // red-700
    glowColor = "rgba(220, 38, 38, 0.25)";
  }

  // Font sizes proportional to size
  const pctFontSize = Math.max(12, Math.round(size * 0.22));
  const labelFontSize = Math.max(9, Math.round(size * 0.085));

  return (
    <div className="relative inline-flex flex-col items-center justify-center select-none">
      <svg 
        width={size} 
        height={size} 
        className="transform -rotate-90 transition-all duration-700"
        style={{ filter: `drop-shadow(0 4px 12px ${glowColor})` }}
      >
        {/* Background track circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Progress animated circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          style={{
            transition: "stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.4s ease"
          }}
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2">
        {showPercentage && (
          <div 
            className="font-extrabold tracking-tight"
            style={{ fontSize: `${pctFontSize}px`, color: textColor, lineHeight: 1.1 }}
          >
            {formatAttendancePercentage(percentage)}%
          </div>
        )}
        {label && (
          <div 
            className="font-medium text-slate-500 uppercase tracking-wider mt-0.5"
            style={{ fontSize: `${labelFontSize}px` }}
          >
            {label}
          </div>
        )}
        {sublabel && (
          <div className="text-[10px] text-slate-400 font-normal">
            {sublabel}
          </div>
        )}
      </div>
    </div>
  );
}
