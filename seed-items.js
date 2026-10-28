require('dotenv').config();
const mongoose = require('mongoose');
const Item = require('./models/Item');

const items = [
  { itemCode: 'ELE-001', itemName: 'Extension Cord', category: 'Electronics' },
  { itemCode: 'ELE-002', itemName: 'Electric Fan', category: 'Electronics' },
  { itemCode: 'GAM-001', itemName: 'Chess Set', category: 'Board and Card Games' },
  { itemCode: 'GAM-002', itemName: 'Uno Cards', category: 'Board and Card Games' },
  { itemCode: 'SPO-001', itemName: 'Basketball', category: 'Sports Equipment' },
  { itemCode: 'APP-001', itemName: 'Raincoat', category: 'Apparel' },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const it of items) {
    await Item.updateOne({ itemCode: it.itemCode }, { $setOnInsert: it }, { upsert: true });
  }
  console.log('Test items ready.');
  await mongoose.disconnect();
})();