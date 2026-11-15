/* global use, db */
// Scout read-only inspection playground. First select your Atlas connection in
// MongoDB for VS Code. Change the database name if MONGODB_DB is not "scout".
// This file contains no credentials and does not insert, update or delete data.
use('scout');

// Replace these IDs with your actual building and location IDs. The final
// expression is shown in the MongoDB playground results panel.
const buildingId = 'local-demo';
const locationId = 'east-door';

db.getCollection('inspections')
  .find({ building_id: buildingId, location_id: locationId })
  .sort({ timestamp: -1, _id: -1 })
  .limit(10)
  .toArray();
