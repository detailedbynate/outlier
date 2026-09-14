import type { ComponentType, ReactNode } from "react";

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: ComponentType<{ size?: number }>;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="spread" style={{ alignItems: "center" }}>
      <div className="page-header">
        <span className="page-icon">
          <Icon size={22} />
        </span>
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}
