import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { parse } from 'expression-eval';

const ODKFormRenderer = () => {
  const [allFormData, setAllFormData] = useState({});
  const [formSchema, setFormSchema] = useState(null);
  const [groups, setGroups] = useState([]);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const formulaCache = useRef(new Map());
  const questionCache = useRef(new Map());

  const pickFormFile = async () => {
    try {
      setLoading(true);
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (result.canceled) return;
      const fileContent = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const parsedForm = JSON.parse(fileContent);
      setFormSchema(parsedForm);
      processGroups(parsedForm);
    } catch (error) {
      Alert.alert('Error', 'Invalid ODK JSON file');
    } finally {
      setLoading(false);
    }
  };

  const processGroups = useCallback((schema) => {
    console.log('Raw Schema:', schema);
    const extractedGroups = schema.map(group => ({
      id: group.groupId,
      name: group.groupName,
      fields: group.lstViewQuestionModel ? group.lstViewQuestionModel.map(field => {
        if (field.questionId) {
          questionCache.current.set(field.questionId, field);
        }
        if (field.questionCalculation) {
          try {
            formulaCache.current.set(field.questionId, parse(field.questionCalculation));
          } catch (e) {
            console.error(`Error parsing formula for ${field.questionId}:`, e);
          }
        }
        return {
          id: field.questionId,
          label: field.question,
          type: field.questionType,
          options: field.controlValue || [],
          required: field.required,
          min: field.minValue,
          max: field.maxValue,
          regex: field.regex,
          parent: field.parentQuestionId,
          calculation: field.questionCalculation,
        };
      }) : []
    }));
    console.log('Extracted Groups:', extractedGroups);
    setGroups(extractedGroups);
  }, []);

  const updateCalculations = (newData) => {
    let updatedData = { ...newData };
    formulaCache.current.forEach((compiledFormula, questionId) => {
      try {
        updatedData[questionId] = compiledFormula.evaluate(updatedData);
      } catch (e) {
        console.error(`Calculation error for ${questionId}:`, e);
      }
    });
    return updatedData;
  };

  const handleInputChange = (id, value) => {
    setAllFormData(prev => {
      const newFormData = { ...prev, [id]: value };
      return updateCalculations(newFormData);
    });
  };

  const validateFields = () => {
    const currentFields = groups[currentGroupIndex]?.fields || [];
    let newErrors = {};
    let isValid = true;

    currentFields.forEach(field => {
      if (field.required && (!allFormData[field.id] || allFormData[field.id].trim() === '')) {
        newErrors[field.id] = 'This field is required';
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  };

  const handleNext = () => {
    if (validateFields()) {
      setCurrentGroupIndex(currentGroupIndex + 1);
    }
  };

  const renderField = ({ item }) => {
    return (
      <View>
        <Text>{item.label}</Text>
        {item.type === 'TextBox' && (
          <TextInput
            style={styles.input}
            value={allFormData[item.id] || ''}
            onChangeText={(text) => handleInputChange(item.id, text)}
          />
        )}
        {item.type === 'Dropdown' && (
          <Picker
            selectedValue={allFormData[item.id] || ''}
            onValueChange={(value) => handleInputChange(item.id, value)}>
            <Picker.Item label="Select" value="" />
            {item.options.map((option, index) => (
              <Picker.Item key={index} label={option.label} value={option.label} />
            ))}
          </Picker>
        )}
        {errors[item.id] && <Text style={styles.errorText}>{errors[item.id]}</Text>}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {!formSchema ? (
        <TouchableOpacity onPress={pickFormFile} style={styles.button}>
          <Text>Choose ODK JSON Form</Text>
        </TouchableOpacity>
      ) : currentGroupIndex === null ? (
        <View>
          <Text style={styles.title}>Select a Group</Text>
          <FlatList
            data={groups}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <TouchableOpacity 
                style={styles.groupButton} 
                onPress={() => setCurrentGroupIndex(index)}
              >
                <Text style={styles.groupText}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      ) : (
        <View style={{ padding: 20 }}>
          <FlatList
            data={groups[currentGroupIndex]?.fields || []}
            renderItem={renderField}
            keyExtractor={(item) => item.id}
          />
          <View style={styles.navigationButtons}>
            <TouchableOpacity 
              style={styles.navButton} 
              onPress={() => setCurrentGroupIndex(null)}
            >
              <Text style={styles.navButtonText}>Back to Groups</Text>
            </TouchableOpacity>
            {currentGroupIndex > 0 && (
              <TouchableOpacity 
                style={styles.navButton} 
                onPress={() => setCurrentGroupIndex(currentGroupIndex - 1)}
              >
                <Text style={styles.navButtonText}>Previous</Text>
              </TouchableOpacity>
            )}
            {currentGroupIndex < groups.length - 1 && (
              <TouchableOpacity 
                style={styles.navButton} 
                onPress={handleNext}
              >
                <Text style={styles.navButtonText}>Next</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  button: { padding: 10, backgroundColor: '#007bff', alignItems: 'center', margin: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 8, marginVertical: 5 },
  errorText: { color: 'red', marginTop: 5 },
  navigationButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    padding: 10,
    backgroundColor: '#f8f9fa',
  },
  navButton: {
    padding: 10,
    backgroundColor: '#007bff',
    borderRadius: 5,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  navButtonText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center'
  }
});

export default ODKFormRenderer;
