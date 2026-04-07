import { DataTypes } from 'sequelize';

export default function defineTicket(sequelize) {
  return sequelize.define('Ticket', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    department_name: { type: DataTypes.STRING, field: 't_to' },
    t_from: DataTypes.STRING,
    from_name: DataTypes.STRING,
    subject: DataTypes.STRING,
    time: DataTypes.DATE,
    contact_status: DataTypes.STRING,
    updated_at: DataTypes.DATE,
  }, { tableName: 'tickets', timestamps: false });
}
