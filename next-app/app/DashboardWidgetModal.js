"use client";

import { useEffect, useMemo, useState } from "react";

const widgetOptions = [
  { value: "switch", label: "Switch", category: "interaction", description: "Toggle a linked variable." },
  { value: "button", label: "Push Button", category: "interaction", description: "Trigger a button-like action." },
  { value: "sidebar", label: "Sidebar", category: "annotation", description: "Pin variable details in a side panel." },
  { value: "stepper", label: "Stepper", category: "interaction", description: "Step through numeric values." },
  { value: "value_display", label: "Value Display", category: "visualisation", description: "Show the latest value clearly." },
  { value: "status", label: "Status", category: "visualisation", description: "Show a compact current-state tile." },
  { value: "percentage", label: "Percentage", category: "visualisation", description: "Render values as percentages." },
  { value: "led", label: "LED", category: "visualisation", description: "Represent LED state visually." }
];

const widgetCategories = [
  { value: "all", label: "All" },
  { value: "interaction", label: "Interaction" },
  { value: "visualisation", label: "Visualisation" },
  { value: "annotation", label: "Annotation" }
];

export default function DashboardWidgetModal({ action, dashboardId, variableOptions }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("widgets");
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("all");
  const [widgetType, setWidgetType] = useState("switch");
  const [tileName, setTileName] = useState("Switch");
  const [selectedVariableId, setSelectedVariableId] = useState("");

  const selectedVariable = useMemo(
    () => variableOptions.find((item) => String(item.variableId) === selectedVariableId) || null,
    [selectedVariableId, variableOptions]
  );

  const filteredWidgets = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return widgetOptions.filter((option) => {
      const matchesCategory = category === "all" || option.category === category;
      const matchesSearch =
        !normalizedSearch ||
        option.label.toLowerCase().includes(normalizedSearch) ||
        option.description.toLowerCase().includes(normalizedSearch);

      return matchesCategory && matchesSearch;
    });
  }, [category, searchTerm]);

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

  useEffect(() => {
    const selectedWidget = widgetOptions.find((option) => option.value === widgetType);
    if (selectedWidget) {
      setTileName(selectedWidget.label);
    }
  }, [widgetType]);

  return (
    <>
      <button className="dashboardAddButton" type="button" onClick={() => setIsOpen(true)}>
        Add
      </button>

      {isOpen ? (
        <div className="widgetModalOverlay" onClick={() => setIsOpen(false)}>
          <div className="widgetModal widgetModalLarge" onClick={(event) => event.stopPropagation()}>
            <div className="widgetModalTopBar">
              <button className="dashboardAddButton dashboardAddButtonActive" type="button">
                Add
              </button>
            </div>

            <div className="widgetModalShell">
              <div className="widgetModalPanel">
                <div className="widgetModalTabs">
                  <button
                    className={`widgetModalTab ${activeTab === "widgets" ? "widgetModalTabActive" : ""}`}
                    type="button"
                    onClick={() => setActiveTab("widgets")}
                  >
                    Widgets
                  </button>
                  <button
                    className={`widgetModalTab ${activeTab === "things" ? "widgetModalTabActive" : ""}`}
                    type="button"
                    onClick={() => setActiveTab("things")}
                  >
                    Things
                  </button>
                </div>

                <div className="widgetSearchRow">
                  <input
                    className="widgetSearchInput"
                    placeholder={activeTab === "widgets" ? "Search widget or variable type" : "Search things or variables"}
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </div>

                {activeTab === "widgets" ? (
                  <>
                    <div className="widgetCategoryRow">
                      {widgetCategories.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`widgetCategoryChip ${category === option.value ? "widgetCategoryChipActive" : ""}`}
                          onClick={() => setCategory(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="widgetPickerGrid widgetPickerGridLarge">
                      {filteredWidgets.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`widgetOptionCard widgetOptionCardLarge ${
                            widgetType === option.value ? "widgetOptionCardActive" : ""
                          }`}
                          onClick={() => setWidgetType(option.value)}
                        >
                          <strong>{option.label}</strong>
                          <span>{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="thingPickerGrid">
                    {filteredVariables.length > 0 ? (
                      filteredVariables.map((variable) => (
                        <button
                          key={variable.variableId}
                          type="button"
                          className={`thingPickerCard ${
                            String(variable.variableId) === selectedVariableId ? "thingPickerCardActive" : ""
                          }`}
                          onClick={() => setSelectedVariableId(String(variable.variableId))}
                        >
                          <strong>{variable.variableName}</strong>
                          <span>{variable.thingName}</span>
                        </button>
                      ))
                    ) : (
                      <div className="historyCard">
                        <strong>No matching variables</strong>
                        <p className="sectionCopy">Try another search or create variables in Things first.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <aside className="widgetPreviewPanel">
                <strong>Widget Setup</strong>
                <p className="sectionCopy">Pick a widget, link a Thing variable, and save it to the dashboard.</p>

                <form action={action} className="widgetModalForm widgetModalFormStack">
                  <input type="hidden" name="dashboardId" value={dashboardId} />
                  <input type="hidden" name="tileType" value={widgetType} />
                  <input type="hidden" name="linkedThingId" value={selectedVariable?.thingId || ""} />

                  <label className="thingField">
                    <span>Widget</span>
                    <input className="input" value={widgetOptions.find((option) => option.value === widgetType)?.label || ""} readOnly />
                  </label>

                  <label className="thingField">
                    <span>Widget Name</span>
                    <input className="input" name="tileName" value={tileName} onChange={(event) => setTileName(event.target.value)} required />
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
                      <option value="">Select Variable</option>
                      {variableOptions.map((variable) => (
                        <option key={variable.variableId} value={variable.variableId}>
                          {variable.thingName} - {variable.variableName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="widgetPreviewSummary">
                    <span>Selected</span>
                    <strong>{widgetOptions.find((option) => option.value === widgetType)?.label || "-"}</strong>
                    <strong>{selectedVariable ? `${selectedVariable.thingName} / ${selectedVariable.variableName}` : "No variable selected"}</strong>
                  </div>

                  <div className="widgetModalActions">
                    <button className="button buttonGhost" type="button" onClick={() => setIsOpen(false)}>
                      Cancel
                    </button>
                    <button className="button buttonOn" type="submit" disabled={!selectedVariableId}>
                      Add Widget
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
