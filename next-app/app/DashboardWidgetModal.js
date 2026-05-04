"use client";

import { useMemo, useState } from "react";

function getWidgetLabels(widgetType) {
  if (widgetType === "value_display") {
    return {
      name: "Value Display",
      addButton: "Add Value",
      helperCopy: "Pick one linked variable for this dashboard tile.",
      searchPlaceholder: "Search things or variables",
      emptyTitle: "No variables found",
      emptyCopy: "Create a Thing variable first, then link it here.",
      selectPlaceholder: "Select Variable",
      unselectedSummary: "No variable selected",
      submitLabel: "Add Value Display"
    };
  }

  return {
    name: "Switch",
    addButton: "Add Switch",
    helperCopy: "Pick one linked switch variable for this dashboard tile.",
    searchPlaceholder: "Search things or switch variables",
    emptyTitle: "No switch variables found",
    emptyCopy: "Create a Thing switch first, then link it here.",
    selectPlaceholder: "Select Switch",
    unselectedSummary: "No switch selected",
    submitLabel: "Add Switch"
  };
}

export default function DashboardWidgetModal({ action, dashboardId, variableOptions }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [widgetType, setWidgetType] = useState("switch");
  const [tileName, setTileName] = useState("Switch");
  const [selectedVariableId, setSelectedVariableId] = useState("");
  const widgetLabels = getWidgetLabels(widgetType);

  function selectWidgetType(nextType) {
    setWidgetType(nextType);
    setTileName(nextType === "value_display" ? "Value Display" : "Switch");
    setSelectedVariableId("");
  }

  const filteredVariables = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return variableOptions.filter((option) => {
      const matchesWidgetType =
        widgetType === "switch" ? option.variableType === "boolean" : true;

      if (!matchesWidgetType) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return (
        option.thingName.toLowerCase().includes(normalizedSearch) ||
        option.variableName.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [searchTerm, variableOptions, widgetType]);

  const selectedVariable =
    filteredVariables.find((item) => String(item.variableId) === selectedVariableId) || null;

  return (
    <>
      <button className="dashboardAddButton" type="button" onClick={() => setIsOpen(true)}>
        Add
      </button>

      {isOpen ? (
        <div className="widgetModalOverlay" onClick={() => setIsOpen(false)}>
          <div className="widgetModal widgetModalCompact" onClick={(event) => event.stopPropagation()}>
            <div className="widgetModalTopBar">
              <button
                className={`dashboardAddButton ${widgetType === "switch" ? "dashboardAddButtonActive" : ""}`}
                type="button"
                onClick={() => selectWidgetType("switch")}
              >
                Add Switch
              </button>
              <button
                className={`dashboardAddButton ${widgetType === "value_display" ? "dashboardAddButtonActive" : ""}`}
                type="button"
                onClick={() => selectWidgetType("value_display")}
              >
                Add Value
              </button>
            </div>

            <div className="widgetModalSimple">
              <section className="widgetModalPanel">
                <div className="widgetSimpleHeader">
                  <strong>{widgetLabels.name} Widgets</strong>
                  <p className="sectionCopy">{widgetLabels.helperCopy}</p>
                </div>

                <div className="widgetSearchRow">
                  <input
                    className="widgetSearchInput"
                    placeholder={widgetLabels.searchPlaceholder}
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </div>

                <div className="thingPickerGrid">
                  {filteredVariables.length > 0 ? (
                    filteredVariables.map((variable) => (
                      <button
                        key={variable.variableId}
                        type="button"
                        className={`thingPickerCard ${
                          String(variable.variableId) === selectedVariableId ? "thingPickerCardActive" : ""
                        }`}
                        onClick={() => {
                          setSelectedVariableId(String(variable.variableId));
                          setTileName(variable.variableName || "Switch");
                        }}
                      >
                        <strong>{variable.variableName}</strong>
                        <span>{variable.thingName}</span>
                      </button>
                    ))
                  ) : (
                    <div className="historyCard">
                      <strong>{widgetLabels.emptyTitle}</strong>
                      <p className="sectionCopy">{widgetLabels.emptyCopy}</p>
                    </div>
                  )}
                </div>
              </section>

              <aside className="widgetPreviewPanel">
                <strong>Widget Setup</strong>
                <p className="sectionCopy">Only switch and value display widgets are available for now.</p>

                <form action={action} className="widgetModalForm widgetModalFormStack">
                  <input type="hidden" name="dashboardId" value={dashboardId} />
                  <input type="hidden" name="tileType" value={widgetType} />
                  <input type="hidden" name="linkedThingId" value={selectedVariable?.thingId || ""} />

                  <label className="thingField">
                    <span>Widget</span>
                    <input className="input" value={widgetLabels.name} readOnly />
                  </label>

                  <label className="thingField">
                    <span>Widget Name</span>
                    <input
                      className="input"
                      name="tileName"
                      value={tileName}
                      onChange={(event) => setTileName(event.target.value)}
                      required
                    />
                  </label>

                  <label className="thingField">
                    <span>Linked Variable</span>
                    <select
                      className="input"
                      name="linkedVariableId"
                      value={selectedVariableId}
                      onChange={(event) => {
                        const nextVariableId = event.target.value;
                        const nextVariable =
                          filteredVariables.find((variable) => String(variable.variableId) === nextVariableId) || null;
                        setSelectedVariableId(nextVariableId);
                        if (nextVariable?.variableName) {
                          setTileName(nextVariable.variableName);
                        }
                      }}
                      required
                    >
                      <option value="">{widgetLabels.selectPlaceholder}</option>
                      {filteredVariables.map((variable) => (
                        <option key={variable.variableId} value={variable.variableId}>
                          {variable.thingName} - {variable.variableName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="widgetPreviewSummary">
                    <span>Selected</span>
                    <strong>{widgetLabels.name}</strong>
                    <strong>
                      {selectedVariable
                        ? `${selectedVariable.thingName} / ${selectedVariable.variableName}`
                        : widgetLabels.unselectedSummary}
                    </strong>
                  </div>

                  <div className="widgetModalActions">
                    <button className="button buttonGhost" type="button" onClick={() => setIsOpen(false)}>
                      Cancel
                    </button>
                    <button className="button buttonOn" type="submit" disabled={!selectedVariableId}>
                      {widgetLabels.submitLabel}
                    </button>
                  </div>
                </form>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
