/** garmin.md §5.3 example payloads, verbatim. */

export const EXAMPLE_A = JSON.parse(`{
  "workoutName": "5x1k @ T pace",
  "description": "Threshold kilometres",
  "sportType": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
  "estimatedDurationInSecs": 3300,
  "workoutSegments": [{
    "segmentOrder": 1,
    "sportType": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
    "workoutSteps": [
      {"type": "ExecutableStepDTO", "stepOrder": 1,
       "stepType": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
       "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
       "endConditionValue": 900.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}},
      {"type": "RepeatGroupDTO", "stepOrder": 2, "childStepId": 1,
       "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
       "numberOfIterations": 5, "smartRepeat": false,
       "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": false},
       "endConditionValue": 5.0,
       "workoutSteps": [
         {"type": "ExecutableStepDTO", "stepOrder": 3, "childStepId": 1,
          "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
          "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
          "endConditionValue": 1000.0,
          "targetType": {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 6},
          "targetValueOne": 3.8462, "targetValueTwo": 4.0,
          "description": "4:20 -> 4:10 /km"},
         {"type": "ExecutableStepDTO", "stepOrder": 4, "childStepId": 1,
          "stepType": {"stepTypeId": 4, "stepTypeKey": "recovery", "displayOrder": 4},
          "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
          "endConditionValue": 120.0,
          "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}}
       ]},
      {"type": "ExecutableStepDTO", "stepOrder": 5,
       "stepType": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
       "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
       "endConditionValue": 600.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}}
    ]
  }]
}`);

export const EXAMPLE_B = JSON.parse(`{
  "workoutName": "4x8 sweet spot",
  "sportType": {"sportTypeId": 2, "sportTypeKey": "cycling", "displayOrder": 2},
  "estimatedDurationInSecs": 3480,
  "workoutSegments": [{
    "segmentOrder": 1,
    "sportType": {"sportTypeId": 2, "sportTypeKey": "cycling", "displayOrder": 2},
    "workoutSteps": [
      {"type": "ExecutableStepDTO", "stepOrder": 1,
       "stepType": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
       "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
       "endConditionValue": 600.0,
       "targetType": {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone", "displayOrder": 4},
       "zoneNumber": 2},
      {"type": "RepeatGroupDTO", "stepOrder": 2, "childStepId": 1,
       "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
       "numberOfIterations": 4, "smartRepeat": false,
       "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": false},
       "endConditionValue": 4.0,
       "workoutSteps": [
         {"type": "ExecutableStepDTO", "stepOrder": 3, "childStepId": 1,
          "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
          "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
          "endConditionValue": 480.0,
          "targetType": {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone", "displayOrder": 2},
          "targetValueOne": 250, "targetValueTwo": 265,
          "secondaryTargetType": {"workoutTargetTypeId": 3, "workoutTargetTypeKey": "cadence", "displayOrder": 3},
          "secondaryTargetValueOne": 85, "secondaryTargetValueTwo": 95},
         {"type": "ExecutableStepDTO", "stepOrder": 4, "childStepId": 1,
          "stepType": {"stepTypeId": 4, "stepTypeKey": "recovery", "displayOrder": 4},
          "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
          "endConditionValue": 240.0,
          "targetType": {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone", "displayOrder": 2},
          "zoneNumber": 1}
       ]},
      {"type": "ExecutableStepDTO", "stepOrder": 5,
       "stepType": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
       "endCondition": {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": true},
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}}
    ]
  }]
}`);

export const EXAMPLE_C = JSON.parse(`{
  "workoutName": "CSS 8x100",
  "sportType": {"sportTypeId": 4, "sportTypeKey": "swimming", "displayOrder": 4},
  "poolLength": 25.0,
  "poolLengthUnit": {"unitId": 1, "unitKey": "meter", "factor": 100.0},
  "estimatedDurationInSecs": 2700,
  "workoutSegments": [{
    "segmentOrder": 1,
    "sportType": {"sportTypeId": 4, "sportTypeKey": "swimming", "displayOrder": 4},
    "workoutSteps": [
      {"type": "ExecutableStepDTO", "stepOrder": 1,
       "stepType": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
       "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
       "endConditionValue": 400.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
       "strokeType": {"strokeTypeId": 0, "displayOrder": 0},
       "equipmentType": {"equipmentTypeId": 0, "displayOrder": 0}},
      {"type": "RepeatGroupDTO", "stepOrder": 2, "childStepId": 1,
       "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
       "numberOfIterations": 8, "smartRepeat": false,
       "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": false},
       "endConditionValue": 8.0,
       "workoutSteps": [
         {"type": "ExecutableStepDTO", "stepOrder": 3, "childStepId": 1,
          "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
          "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
          "endConditionValue": 100.0,
          "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
          "secondaryTargetType": {"workoutTargetTypeId": 17, "workoutTargetTypeKey": "swim.css.offset", "displayOrder": 2},
          "secondaryTargetValueOne": 3.0, "secondaryTargetValueTwo": 0.0,
          "strokeType": {"strokeTypeId": 6, "strokeTypeKey": "free"},
          "equipmentType": {"equipmentTypeId": 0, "displayOrder": 0}},
         {"type": "ExecutableStepDTO", "stepOrder": 4, "childStepId": 1,
          "stepType": {"stepTypeId": 5, "stepTypeKey": "rest", "displayOrder": 5},
          "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": true},
          "endConditionValue": 15.0,
          "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}}
       ]},
      {"type": "ExecutableStepDTO", "stepOrder": 5,
       "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
       "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
       "endConditionValue": 200.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
       "strokeType": {"strokeTypeId": 6, "strokeTypeKey": "free"},
       "equipmentType": {"equipmentTypeId": 4, "equipmentTypeKey": "pull_buoy"},
       "description": "pull"},
      {"type": "ExecutableStepDTO", "stepOrder": 6,
       "stepType": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
       "endCondition": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": true},
       "endConditionValue": 100.0,
       "targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1},
       "strokeType": {"strokeTypeId": 0, "displayOrder": 0},
       "equipmentType": {"equipmentTypeId": 0, "displayOrder": 0}}
    ]
  }]
}`);
