/**
 * design-template-detail.tsx — Route wrapper for Template Detail page
 * Route: /design-templates/:id
 */
import { useParams } from "wouter";
import { DesignTemplateDetailPage } from "./design-templates";

export default function DesignTemplateDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const numId = parseInt(id ?? "", 10);

  if (isNaN(numId)) {
    return (
      <div className="p-6 text-center text-red-400" data-testid="invalid-id">
        Invalid template ID
      </div>
    );
  }

  return <DesignTemplateDetailPage id={numId} />;
}
