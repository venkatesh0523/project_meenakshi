"use client";

import { useMemo, useState } from "react";

export default function DashboardWidgetModal({ action, dashboardId, variableOptions }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [widgetType, setWidgetType] = useState("switch");
  const [tileName, setTileName] = useState("Switch");
  const [selectedVariableId, setSelectedVariableId] = useState("");

  function selectWidgetType(nextType) {
    setWidgetType(nextType);
    setTileName(nextType === "value_display" ? "Value Display" : "Switch");
  }

  const filteredVariables = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return variableOptions.filter((option) => {
      if (!normalizedSearch) {
        return true;
      }

      return (
        option.thingName.toLowerCase().includes(normalizedSearch) ||
        option.variableName.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [searchTerm, variableOptions]);

  const selectedVariable =
    variableOptions.find((item) => String(item.variableId) === selectedVariableId) || null;

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
                  <strong>{widgetType === "value_display" ? "Value Display" : "Switch"} Widgets</strong>
                  <p className="sectionCopy">
                    Pick one linked switch variable for this dashboard tile.
                  </p>
                </div>

                <div className="widgetSearchRow">
                  <input
                    className="widgetSearchInput"
                    placeholder="Search things or switch variables"
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
                      <strong>No switch variables found</strong>
                      <p className="sectionCopy">Create a Thing switch first, then link it here.</p>
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
                    <input className="input" value={widgetType === "value_display" ? "Value Display" : "Switch"} readOnly />
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
                      onChange={(event) => setSelectedVariableId(event.target.value)}
                      required
                    >
                      <option value="">{widgetType === "value_display" ? "Select Variable" : "Select Switch"}</option>
                      {variableOptions.map((variable) => (
                        <option key={variable.variableId} value={variable.variableId}>
                          {variable.thingName} - {variable.variableName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="widgetPreviewSummary">
                    <span>Selected</span>
                    <strong>{widgetType === "value_display" ? "Value Display" : "Switch"}</strong>
                    <strong>
                      {selectedVariable
                        ? `${selectedVariable.thingName} / ${selectedVariable.variableName}`
                        : widgetType === "value_display"
                          ? "No variable selected"
                          : "No switch selected"}
                    </strong>
                  </div>

                  <div className="widgetModalActions">
                    <button className="button buttonGhost" type="button" onClick={() => setIsOpen(false)}>
                      Cancel
                    </button>
                    <button className="button buttonOn" type="submit" disabled={!selectedVariableId}>
                      {widgetType === "value_display" ? "Add Value Display" : "Add Switch"}
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
