/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/log', 'N/search', 'N/format'], function (record, log, search, format) {

    function afterSubmit(context) {

        // Array to store names of items that are not warranty tracked
        var notWarrantyTrackedItems = [];

        // Arrays to store log messages
        var conditionMetLogs = [];
        var noWarrantyRecordLogs = [];
        var scuWarrantyRecordLogs = [];
        var warrantyRecordSavedLogs = [];
        var existingWarrantyTimeDeletedLogs = [];

        // Get the new record object
        var newRecord = context.newRecord;
        // Get the ID of the Item Receipt
        var itemReceiptId = newRecord.id;
        // Load the Item Receipt record
        var itemReceipt = record.load({
            type: record.Type.ITEM_RECEIPT,
            id: itemReceiptId,
            isDynamic: false
        });

        // Retrieve the from and to locations
        var toLocationId = itemReceipt.getValue({ fieldId: 'location' });
        var fromLocationId = itemReceipt.getValue({ fieldId: 'transferlocation' });

        // Check the from and to locations. 321 is CB Warehouse and 332 is CB Repairs.
        // So if going from 321 and not to 332, it must be going to a hub and needs warranty.
        // If the company expands, this could instead be set to check if the location is a warehouse or a store.
        if ((fromLocationId == 321 && (toLocationId !== 332 && toLocationId !== 336 && toLocationId !== 342))
            || (fromLocationId == 332 && (toLocationId !== 321 && toLocationId !== 336 && toLocationId !== 342))
            || (fromLocationId == 336 && (toLocationId !== 321 && toLocationId !== 332 && toLocationId !== 342))
            || (fromLocationId == 342 && (toLocationId !== 321 && toLocationId !== 332 && toLocationId !== 336))) {

            conditionMetLogs.push('Condition met, processing script for record ' + itemReceiptId + '.');

            // Retrieve item details from the Item Receipt's line items
            var lineCount = itemReceipt.getLineCount({ sublistId: 'item' });
            var locationName = getLocationName(toLocationId);

            // Loop through each line item on the Item Receipt
            for (var i = 0; i < lineCount; i++) {
                var itemId = itemReceipt.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                // Retrieve the item type directly from the item sublist
                var itemType;
                var itemType = itemReceipt.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });

                // Determine record type based on itemType
                var recordType;
                if (itemType === 'InvtPart') {
                    recordType = record.Type.INVENTORY_ITEM;
                } else if (itemType === 'Assembly') {
                    recordType = record.Type.ASSEMBLY_ITEM;
                } else {
                    var itemName = itemReceipt.getSublistText({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    });

                    throw error.create({
                        name: "Invalid Item Type",
                        message: itemName + " is not a valid fixed asset item type. It is " + itemType,
                        notifyOff: false
                    });
                }

                // Load the item record
                var itemRecord = record.load({
                    type: recordType,
                    id: itemId
                });

                var isWarrantyTracked = itemRecord.getValue({ fieldId: 'custitem_wrm_item_trackwarranty' });

                if (isWarrantyTracked) {
                    var itemName = itemReceipt.getSublistText({ sublistId: 'item', fieldId: 'item', line: i });

                    // Retrieve the warranty term and type from the item record
                    var warrantyTerm = itemRecord.getValue({ fieldId: 'custitem_wrm_item_warrantyterms' });
                    var warrantyItemType = itemRecord.getValue({ fieldId: 'custitem_warranty_item_type' });

                    // Retrieve inventory detail subrecord
                    var inventoryDetailSubrecord = itemReceipt.getSublistSubrecord({
                        sublistId: 'item',
                        fieldId: 'inventorydetail',
                        line: i
                    });

                    if (inventoryDetailSubrecord) {
                        // Retrieve serial numbers from inventory assignments within inventory detail subrecord
                        var inventoryAssignmentCount = inventoryDetailSubrecord.getLineCount({ sublistId: 'inventoryassignment' });
                        // Hubs will only recieve so many items at a time, so governance credits are not a concern
                        // But for future work, the process can be restructured to significantly reduce governance credits
                        for (var j = 0; j < inventoryAssignmentCount; j++) {
                            var serialNumber = inventoryDetailSubrecord.getSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'receiptinventorynumber',
                                line: j
                            });

                            if (serialNumber) {
                                // Create warranty record
                                var warrantyRecord = record.create({ type: 'customrecord_wrm_warrantyreg', isDynamic: true });

                                // Set fields on the warranty record
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_ref_invoice', value: itemReceiptId });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_subsidiary', value: 23 });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_ref_seriallot', value: serialNumber });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_customer', value: 5173 });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_quantity', value: 1 });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_warrantyterm', value: warrantyTerm });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_item', value: itemName });
                                warrantyRecord.setValue({ fieldId: 'custrecord_custom_location', value: toLocationId });

                                // Populate the shiptoaddress field with the location name
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_shiptoaddress', value: locationName });

                                // Populate the warranty item type field
                                warrantyRecord.setValue({ fieldId: 'custrecord_warranty_item_type', value: warrantyItemType });

                                // Populate the remarks field
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_remarks', value: 'This record was automatically generated.' });

                                // Check if there's an existing warranty time record for this item type and location
                                var existingWarrantyTimeSearch = search.create({
                                    type: 'customrecord_warranty_time',
                                    filters: [
                                        ['custrecord_item_type', 'anyof', warrantyItemType],
                                        'AND',
                                        ['custrecord_time_pool_location', 'anyof', toLocationId]
                                    ],
                                    columns: ['internalid', 'custrecord_days_remaining']
                                });

                                var existingWarrantyTimeResults = existingWarrantyTimeSearch.run().getRange({ start: 0, end: 1 });

                                var currentDate = new Date();
                                if (existingWarrantyTimeResults.length > 0) {
                                    // Use existing warranty time record to calculate expiration date
                                    var daysRemaining = parseInt(existingWarrantyTimeResults[0].getValue({ name: 'custrecord_days_remaining' }), 10);
                                    var expirationDate = new Date(currentDate.getTime() + (daysRemaining * 24 * 60 * 60 * 1000));

                                } else {
                                    // Handle case where no existing warranty time record is found
                                    noWarrantyRecordLogs.push('No existing warranty time record found for item type: ' + warrantyItemType);
                                    // Check if the item type is one of the specified component types
                                    var componentTypes = ['Lightning Protection System', 'Solar Charge Controller', 'Power Box', 'Comms Box'];
                                    if (componentTypes.indexOf(warrantyItemType) !== -1) {
                                        // Check for SCU warranty record if no existing time pool record
                                        var scuWarrantySearch = search.create({
                                            type: 'customrecord_wrm_warrantyreg',
                                            filters: [
                                                ['custrecord_warranty_item_type', 'anyof', 'System Control Unit'],
                                                'AND',
                                                ['custrecord_custom_location', 'anyof', toLocationId]
                                            ],
                                            columns: ['custrecord_wrm_reg_warrantyexpire']
                                        });

                                        var scuWarrantyResults = scuWarrantySearch.run().getRange({ start: 0, end: 1 });

                                        if (scuWarrantyResults.length > 0) {
                                            // Use SCU warranty expiration date
                                            expirationDate = format.parse({ type: format.Type.DATE, value: scuWarrantyResults[0].getValue({ name: 'custrecord_wrm_reg_warrantyexpire' }) });
                                            scuWarrantyRecordLogs.push('Expiration date set based on existing SCU warranty record.');
                                        } else {
                                            // Calculate the expiration date for the warranty (current date + 10 years) since it's a new item
                                            var itemReceiptDate = itemReceipt.getValue({ fieldId: 'trandate' });
                                            var receiptDate = format.parse({ type: format.Type.DATE, value: itemReceiptDate });
                                            expirationDate = new Date(receiptDate.getFullYear() + 10, receiptDate.getMonth(), receiptDate.getDate());
                                            noWarrantyRecordLogs.push('Expiration date set to 10 years from the item receipt date since no existing warranty time or SCU warranty record was found for item type: ' + warrantyItemType);
                                        }
                                    } else {
                                        // Get the item receipt date
                                        var itemReceiptDate = itemReceipt.getValue({ fieldId: 'trandate' });

                                        // Convert the item receipt date to a JavaScript Date object
                                        var receiptDate = format.parse({ type: format.Type.DATE, value: itemReceiptDate });

                                        // Calculate the expiration date for the warranty (item receipt date + 10 years) since it's a new item
                                        expirationDate = new Date(receiptDate.getFullYear() + 10, receiptDate.getMonth(), receiptDate.getDate());
                                        noWarrantyRecordLogs.push('Expiration date set to 10 years from the item receipt date since no existing warranty time or SCU warranty record was found for item type: ' + warrantyItemType);
                                    }
                                }

                                // Set expiration date on the warranty record
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_warrantyexpire', value: expirationDate });

                                // Save warranty record
                                var warrantyRecordId = warrantyRecord.save();
                                warrantyRecordSavedLogs.push('Warranty record saved with ID: ' + warrantyRecordId);

                                // Delete the existing warranty time record only if the new warranty record is saved successfully
                                if (existingWarrantyTimeResults.length > 0) {
                                    record.delete({ type: 'customrecord_warranty_time', id: existingWarrantyTimeResults[0].id });
                                    existingWarrantyTimeDeletedLogs.push('Existing warranty time record deleted.');
                                }
                            }
                        }
                    }
                } else {
                    // Add item name to the array if not warranty tracked
                    var itemName = itemReceipt.getSublistText({ sublistId: 'item', fieldId: 'item', line: i });
                    notWarrantyTrackedItems.push(itemName);
                }
            }
        }

        // Log the accumulated messages at the end
        if (conditionMetLogs.length > 0) {
            log.debug('Condition Met Logs:', conditionMetLogs.join('; '));
        }
        if (noWarrantyRecordLogs.length > 0) {
            log.debug('No Warranty Record Logs:', noWarrantyRecordLogs.join('; '));
        }
        if (scuWarrantyRecordLogs.length > 0) {
            log.debug('SCU Warranty Record Logs:', scuWarrantyRecordLogs.join('; '));
        }
        if (warrantyRecordSavedLogs.length > 0) {
            log.debug('Warranty Record Saved Logs:', warrantyRecordSavedLogs.join('; '));
        }
        if (existingWarrantyTimeDeletedLogs.length > 0) {
            log.debug('Existing Warranty Time Deleted Logs:', existingWarrantyTimeDeletedLogs.join('; '));
        }
        if (notWarrantyTrackedItems.length > 0) {
            log.debug('Items not warranty tracked:', notWarrantyTrackedItems.join(', '));
        }
    }

    // Function to get location name
    function getLocationName(locationId) {
        var locationName = '';
        var locationSearch = search.lookupFields({
            type: search.Type.LOCATION,
            id: locationId,
            columns: ['name']
        });
        if (locationSearch && locationSearch.name) {
            locationName = locationSearch.name;
        }
        return locationName;
    }

    return {
        afterSubmit: afterSubmit
    };
});
