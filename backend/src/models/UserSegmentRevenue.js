import { DataTypes } from 'sequelize';

export default function defineUserSegmentRevenue(sequelize) {
  return sequelize.define(
    'UserSegmentRevenue',
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      segments_title: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      revenue: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },

      created_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      updated_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },

      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'user_segment_revenue',
      timestamps: false,
    }
  );
}