const mongoose = require('mongoose');

const CATEGORIES = [
  'Apparel',
  'Electronics',
  'Board and Card Games',
  'Sports Equipment',
  'Others',
];

const itemSchema = new mongoose.Schema(
  {
    itemCode: { type: String, required: true, unique: true, trim: true },
    itemName: { type: String, required: true, trim: true },
    category: { type: String, enum: CATEGORIES, required: true },
    status: {
      type: String,
      enum: ['available', 'rented', 'maintenance', 'damaged'],
      default: 'available',
    },
  },
  { timestamps: true }
);

const Item = mongoose.model('Item', itemSchema);
Item.CATEGORIES = CATEGORIES; // so other files can reuse the category list

module.exports = Item;