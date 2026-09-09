const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema(
  {
    id:       { type: Number, required: true, unique: true },
    chatId:   { type: Number, required: true },
    userId:   { type: Number, required: true },
    message:  { type: String, required: true },
    fireAt:   { type: Date,   required: true },
    fired:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

reminderSchema.index({ fireAt: 1, fired: 1 });

module.exports = mongoose.model('Reminder', reminderSchema);
