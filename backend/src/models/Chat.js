import { DataTypes } from 'sequelize';

export default function defineChat(sequelize) {
  return sequelize.define('Chat', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    customer_no: { type: DataTypes.STRING, field: 'wa_id' },
    wa_name: DataTypes.STRING,
    email: DataTypes.STRING,
    country: DataTypes.STRING,
    department_number: { type: DataTypes.STRING, field: 'receiver' },
    tags: DataTypes.STRING,
    last_in: DataTypes.DATE,
    last_out: DataTypes.DATE,
    last_msg: DataTypes.DATE,
    created_at: DataTypes.DATE,
  }, { tableName: 'chats', timestamps: false });
}
